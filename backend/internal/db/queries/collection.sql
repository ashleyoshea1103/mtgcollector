-- Queries for the collection (internal/collection). Every query of entries is for one user's:
-- user_id is in its WHERE clause. Prices come from the entry_prices view. Names sort by the
-- "unicode" collation (ICU's root), so "Æther Vial" comes with the aethers, not after "Zur",
-- whatever the database's own collation is.

-- name: CardFinishes :one
SELECT finishes FROM cards WHERE id = @id;

-- name: AddEntry :one
-- Adds copies: a new entry, or more of one the user has with the same printing, finish,
-- condition and language. No row when there's no such card, it doesn't come in that finish,
-- there would be more than max_quantity copies, or it would be a new entry and the user already has
-- max_entries. (That limit is approximate: adds at the same moment can each see room.)
INSERT INTO collection_entries AS e (user_id, card_id, quantity, finish, condition, language)
SELECT @user_id, c.id, @quantity, @finish, @condition, @language
  FROM cards c
 WHERE c.id = @card_id AND @finish::text = ANY (c.finishes)
   AND ((SELECT count(*) FROM collection_entries WHERE user_id = @user_id) < @max_entries::integer
        OR EXISTS (SELECT 1 FROM collection_entries
                    WHERE user_id = @user_id AND card_id = @card_id AND finish = @finish
                      AND condition = @condition AND language = @language))
ON CONFLICT (user_id, card_id, finish, condition, language)
DO UPDATE SET quantity = e.quantity + excluded.quantity
        WHERE e.quantity + excluded.quantity <= @max_quantity::integer
RETURNING e.id, (xmax = 0)::boolean AS created; -- xmax is 0 for a row this statement inserted

-- name: HasEntry :one
-- Whether the user has an entry for this printing, finish, condition and language.
SELECT EXISTS (SELECT 1 FROM collection_entries
                WHERE user_id = @user_id AND card_id = @card_id AND finish = @finish
                  AND condition = @condition AND language = @language);

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
-- One entry of the collection (group 0), or one member of a group.
SELECT sqlc.embed(p), sqlc.embed(v)
  FROM listing_rows p
  JOIN card_listing v ON v.id = p.card_id
 WHERE p.group_id = @group_id AND p.user_id = @user_id AND p.id = @id;

-- name: GroupTotals :many
-- The groups of the user's collection (group 0) or one of their custom groups, for one way of
-- grouping, with their totals: of the copies listed (a member's, in a custom group). Cards
-- with no price are counted apart from the value.
SELECT card_group(@group_by, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc)::text AS key,
       count(*)::integer AS entry_count,
       sum(p.count)::integer AS card_count,
       coalesce(sum(p.count_value), 0)::numeric AS value_eur,
       coalesce(sum(p.count) FILTER (WHERE p.unit_price IS NULL), 0)::integer AS unpriced_count
  FROM listing_rows p
 WHERE p.group_id = @group_id AND p.user_id = @user_id
 GROUP BY 1;

-- name: CollectionStats :many
-- The user's totals in one pass: over everything (totals_of 3), by colour group (1) and by
-- rarity (2). The whole-collection row is there even when the collection is empty.
SELECT GROUPING(g.color, g.rarity)::integer AS totals_of,
       coalesce(g.color, '')::text AS color,
       coalesce(g.rarity, '')::text AS rarity,
       coalesce(sum(g.quantity), 0)::integer AS card_count,
       coalesce(sum(g.value), 0)::numeric AS value_eur,
       coalesce(sum(g.quantity) FILTER (WHERE g.unit_price IS NULL), 0)::integer AS unpriced_count,
       count(DISTINCT g.card_id)::integer AS unique_cards
  FROM (SELECT p.quantity, p.value, p.unit_price, p.card_id, p.rarity,
               card_group('color', p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc) AS color
          FROM entry_prices p
         WHERE p.user_id = @user_id) g
 GROUP BY GROUPING SETS ((), (g.color), (g.rarity));

-- name: SetsByCode :many
-- The sets with these codes: the groups when grouping by set.
SELECT code, name, icon_svg_uri, released_at FROM sets WHERE code = ANY (@codes::text[]);

-- A page of the entries of the collection (group_id 0) or the members of a custom group, in
-- one of the groups card_group makes of them (group_by 'none' is every one: key 'all'), in one
-- order. Each order is its own query, so each can page by keyset: the page after the row
-- whose sort key is the cursor's.

-- name: EntriesByName :many
SELECT sqlc.embed(p), sqlc.embed(v)
  FROM listing_rows p
  JOIN card_listing v ON v.id = p.card_id
 WHERE p.group_id = @group_id AND p.user_id = @user_id
   AND card_group(@group_by, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (p.name COLLATE "unicode", p.id) > (sqlc.narg(after_name)::text COLLATE "unicode", sqlc.narg(after_id)::bigint))
 ORDER BY p.name COLLATE "unicode", p.id
 LIMIT @row_limit;

-- name: EntriesByPrice :many
-- Most valuable copy first; those with no price last.
SELECT sqlc.embed(p), sqlc.embed(v)
  FROM listing_rows p
  JOIN card_listing v ON v.id = p.card_id
 WHERE p.group_id = @group_id AND p.user_id = @user_id
   AND card_group(@group_by, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (p.unit_price IS NULL, -coalesce(p.unit_price, 0), p.id)
         > (sqlc.narg(after_unpriced)::boolean, -coalesce(sqlc.narg(after_price)::numeric, 0), sqlc.narg(after_id)::bigint))
 ORDER BY p.unit_price IS NULL, -coalesce(p.unit_price, 0), p.id
 LIMIT @row_limit;

-- name: EntriesByCMC :many
SELECT sqlc.embed(p), sqlc.embed(v)
  FROM listing_rows p
  JOIN card_listing v ON v.id = p.card_id
 WHERE p.group_id = @group_id AND p.user_id = @user_id
   AND card_group(@group_by, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (p.cmc, p.name COLLATE "unicode", p.id)
         > (sqlc.narg(after_cmc)::numeric, sqlc.narg(after_name)::text COLLATE "unicode", sqlc.narg(after_id)::bigint))
 ORDER BY p.cmc, p.name COLLATE "unicode", p.id
 LIMIT @row_limit;

-- name: EntriesByAdded :many
-- Newest first: added to the collection, or to the group.
SELECT sqlc.embed(p), sqlc.embed(v)
  FROM listing_rows p
  JOIN card_listing v ON v.id = p.card_id
 WHERE p.group_id = @group_id AND p.user_id = @user_id
   AND card_group(@group_by, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc) = @group_key
   AND (sqlc.narg(after_id)::bigint IS NULL
        OR (p.listed_at, p.id) < (sqlc.narg(after_added)::timestamptz, sqlc.narg(after_id)::bigint))
 ORDER BY p.listed_at DESC, p.id DESC
 LIMIT @row_limit;
