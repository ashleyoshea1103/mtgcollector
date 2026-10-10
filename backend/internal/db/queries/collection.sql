-- Queries for the collection (internal/collection). Every one is for one user's entries:
-- user_id is in every WHERE clause.

-- name: CardFinishes :one
SELECT finishes FROM cards WHERE id = @id;

-- name: AddEntry :one
-- Adds copies: a new entry, or more of one the user has with the same printing, finish,
-- condition and language. No row when that would make more than 999 copies.
INSERT INTO collection_entries AS e (user_id, card_id, quantity, finish, condition, language)
VALUES (@user_id, @card_id, @quantity, @finish, @condition, @language)
ON CONFLICT (user_id, card_id, finish, condition, language)
DO UPDATE SET quantity = e.quantity + excluded.quantity
        WHERE e.quantity + excluded.quantity <= 999
RETURNING e.id, (xmax = 0)::boolean AS created; -- xmax is 0 for a row this statement inserted

-- name: EntryCard :one
-- What an entry is, for checking a change to it.
SELECT e.quantity, e.finish, e.condition, e.language, c.finishes
  FROM collection_entries e
  JOIN cards c ON c.id = e.card_id
 WHERE e.user_id = @user_id AND e.id = @id;

-- name: UpdateEntry :one
UPDATE collection_entries
   SET quantity = @quantity, finish = @finish, condition = @condition, language = @language
 WHERE user_id = @user_id AND id = @id
RETURNING id;

-- name: DeleteEntry :execrows
DELETE FROM collection_entries WHERE user_id = @user_id AND id = @id;

-- name: GetEntry :one
SELECT e.id, e.quantity, e.finish, e.condition, e.language, e.added_at,
       unit_price_eur(e.finish, v.price_eur, v.price_eur_foil)::numeric AS unit_price,
       line_value(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), e.quantity)::numeric AS value,
       sqlc.embed(v)
  FROM collection_entries e
  JOIN card_listing v ON v.id = e.card_id
 WHERE e.user_id = @user_id AND e.id = @id;

-- name: GroupTotals :many
-- The groups of the user's collection for one way of grouping, with their totals. Cards
-- with no price are counted apart from the value.
SELECT card_group(@group_by, c.set_code, c.color_identity, c.type_line, c.rarity, c.cmc)::text AS key,
       count(*)::integer AS entry_count,
       sum(e.quantity)::integer AS card_count,
       coalesce(sum(line_value(unit_price_eur(e.finish, c.price_eur, c.price_eur_foil), e.quantity)), 0)::numeric AS value_eur,
       coalesce(sum(e.quantity) FILTER (WHERE unit_price_eur(e.finish, c.price_eur, c.price_eur_foil) IS NULL), 0)::integer AS unpriced_count
  FROM collection_entries e
  JOIN cards c ON c.id = e.card_id
 WHERE e.user_id = @user_id
 GROUP BY 1;

-- name: SetsByCode :many
-- The sets with these codes: the groups when grouping by set.
SELECT code, name, icon_svg_uri, released_at FROM sets WHERE code = ANY (@codes::text[]);

-- name: UniqueCards :one
-- Distinct printings the user owns.
SELECT count(DISTINCT card_id)::integer FROM collection_entries WHERE user_id = @user_id;

-- A page of one group's entries, in one order. Each order is its own query, so each can
-- page by keyset: the page after the row whose sort key is the cursor's. The group is the
-- one card_group gives the key for; group_by 'none' is every entry.

-- name: EntriesByName :many
SELECT e.id, e.quantity, e.finish, e.condition, e.language, e.added_at,
       unit_price_eur(e.finish, v.price_eur, v.price_eur_foil)::numeric AS unit_price,
       line_value(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), e.quantity)::numeric AS value,
       sqlc.embed(v)
  FROM collection_entries e
  JOIN card_listing v ON v.id = e.card_id
 WHERE e.user_id = @user_id
   AND card_group(@group_by, v.set_code, v.color_identity, v.type_line, v.rarity, v.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL OR (v.name, e.id) > (sqlc.narg(after_name)::text, sqlc.narg(after_id)::bigint))
 ORDER BY v.name, e.id
 LIMIT @row_limit;

-- name: EntriesByPrice :many
-- Most valuable copy first; those with no price last.
SELECT e.id, e.quantity, e.finish, e.condition, e.language, e.added_at,
       unit_price_eur(e.finish, v.price_eur, v.price_eur_foil)::numeric AS unit_price,
       line_value(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), e.quantity)::numeric AS value,
       sqlc.embed(v)
  FROM collection_entries e
  JOIN card_listing v ON v.id = e.card_id
 WHERE e.user_id = @user_id
   AND card_group(@group_by, v.set_code, v.color_identity, v.type_line, v.rarity, v.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (unit_price_eur(e.finish, v.price_eur, v.price_eur_foil) IS NULL,
            -coalesce(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), 0), e.id)
         > (sqlc.narg(after_unpriced)::boolean, -coalesce(sqlc.narg(after_price)::numeric, 0), sqlc.narg(after_id)::bigint))
 ORDER BY unit_price_eur(e.finish, v.price_eur, v.price_eur_foil) IS NULL,
          -coalesce(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), 0), e.id
 LIMIT @row_limit;

-- name: EntriesByCMC :many
SELECT e.id, e.quantity, e.finish, e.condition, e.language, e.added_at,
       unit_price_eur(e.finish, v.price_eur, v.price_eur_foil)::numeric AS unit_price,
       line_value(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), e.quantity)::numeric AS value,
       sqlc.embed(v)
  FROM collection_entries e
  JOIN card_listing v ON v.id = e.card_id
 WHERE e.user_id = @user_id
   AND card_group(@group_by, v.set_code, v.color_identity, v.type_line, v.rarity, v.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (v.cmc, v.name, e.id) > (sqlc.narg(after_cmc)::numeric, sqlc.narg(after_name)::text, sqlc.narg(after_id)::bigint))
 ORDER BY v.cmc, v.name, e.id
 LIMIT @row_limit;

-- name: EntriesByAdded :many
-- Newest first.
SELECT e.id, e.quantity, e.finish, e.condition, e.language, e.added_at,
       unit_price_eur(e.finish, v.price_eur, v.price_eur_foil)::numeric AS unit_price,
       line_value(unit_price_eur(e.finish, v.price_eur, v.price_eur_foil), e.quantity)::numeric AS value,
       sqlc.embed(v)
  FROM collection_entries e
  JOIN card_listing v ON v.id = e.card_id
 WHERE e.user_id = @user_id
   AND card_group(@group_by, v.set_code, v.color_identity, v.type_line, v.rarity, v.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (e.added_at, e.id) < (sqlc.narg(after_added)::timestamptz, sqlc.narg(after_id)::bigint))
 ORDER BY e.added_at DESC, e.id DESC
 LIMIT @row_limit;
