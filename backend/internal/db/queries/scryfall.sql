-- Queries for the Scryfall import (internal/cards).

-- name: UpsertSets :batchexec
-- Inserts a set, or updates it if anything about it changed (including its code: a set is
-- identified by its Scryfall id, and a new code cascades to its cards). Sets that haven't
-- changed aren't touched, so they aren't locked or rewritten. Sent as one batch for all sets.
INSERT INTO sets (code, scryfall_id, name, set_type, released_at, icon_svg_uri, parent_set_code)
SELECT @code::text, @scryfall_id::uuid, @name::text, @set_type::text, sqlc.narg(released_at)::date,
       sqlc.narg(icon_svg_uri)::text, sqlc.narg(parent_set_code)::text
 WHERE NOT EXISTS (
       SELECT FROM sets s
        WHERE s.scryfall_id = @scryfall_id::uuid
          AND (s.code, s.name, s.set_type, s.released_at, s.icon_svg_uri, s.parent_set_code)
              IS NOT DISTINCT FROM
              (@code::text, @name::text, @set_type::text, sqlc.narg(released_at)::date,
               sqlc.narg(icon_svg_uri)::text, sqlc.narg(parent_set_code)::text))
ON CONFLICT (scryfall_id) DO UPDATE
   SET code            = EXCLUDED.code,
       name            = EXCLUDED.name,
       set_type        = EXCLUDED.set_type,
       released_at     = EXCLUDED.released_at,
       icon_svg_uri    = EXCLUDED.icon_svg_uri,
       parent_set_code = EXCLUDED.parent_set_code,
       updated_at      = now();

-- name: ClearStagedCards :exec
TRUNCATE cards_staging;

-- name: AnalyzeStagedCards :exec
-- Gives the planner the staged table's real size before the merge (autovacuum won't have yet).
ANALYZE cards_staging;

-- name: StageCards :copyfrom
INSERT INTO cards_staging (
    id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
    type_line, oracle_text, colors, color_identity, finishes, images, faces,
    price_eur, price_eur_foil, price_usd, price_usd_foil, price_usd_etched,
    cardmarket_id, cardmarket_url, released_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17,
    $18, $19, $20, $21, $22,
    $23, $24, $25
);

-- name: CountCards :one
-- Cards in the latest bulk file (not gone), and how many of those aren't staged now: the
-- ones this import would mark gone.
SELECT count(*) AS present,
       count(*) FILTER (WHERE NOT EXISTS (SELECT FROM cards_staging s WHERE s.id = c.id)) AS unstaged
  FROM cards c
 WHERE c.gone_since IS NULL;

-- name: MergeStagedCards :execrows
-- Moves the staged cards into cards. Only new cards, changed cards and cards coming back
-- after being gone are written: the rest aren't touched, so a daily import that moves a
-- few prices rewrites (and locks, and logs) just those rows. Returns how many were written.
INSERT INTO cards (
    id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
    type_line, oracle_text, colors, color_identity, finishes, images, faces,
    price_eur, price_eur_foil, price_usd, price_usd_foil, price_usd_etched,
    cardmarket_id, cardmarket_url, released_at
)
SELECT DISTINCT ON (s.id)
    s.id, s.oracle_id, s.name, s.lang, s.set_code, s.collector_number, s.rarity, s.layout, s.mana_cost, s.cmc,
    s.type_line, s.oracle_text, s.colors, s.color_identity, s.finishes, s.images, s.faces,
    s.price_eur, s.price_eur_foil, s.price_usd, s.price_usd_foil, s.price_usd_etched,
    s.cardmarket_id, s.cardmarket_url, s.released_at
  FROM cards_staging s
  LEFT JOIN cards c ON c.id = s.id
 WHERE c.id IS NULL
    OR c.gone_since IS NOT NULL
    OR (c.oracle_id, c.name, c.lang, c.set_code, c.collector_number, c.rarity, c.layout, c.mana_cost,
        c.cmc, c.type_line, c.oracle_text, c.colors, c.color_identity, c.finishes, c.images, c.faces,
        c.price_eur, c.price_eur_foil, c.price_usd, c.price_usd_foil, c.price_usd_etched,
        c.cardmarket_id, c.cardmarket_url, c.released_at)
       IS DISTINCT FROM
       (s.oracle_id, s.name, s.lang, s.set_code, s.collector_number, s.rarity, s.layout, s.mana_cost,
        s.cmc, s.type_line, s.oracle_text, s.colors, s.color_identity, s.finishes, s.images, s.faces,
        s.price_eur, s.price_eur_foil, s.price_usd, s.price_usd_foil, s.price_usd_etched,
        s.cardmarket_id, s.cardmarket_url, s.released_at)
 ORDER BY s.id
ON CONFLICT (id) DO UPDATE
   SET oracle_id        = EXCLUDED.oracle_id,
       name             = EXCLUDED.name,
       lang             = EXCLUDED.lang,
       set_code         = EXCLUDED.set_code,
       collector_number = EXCLUDED.collector_number,
       rarity           = EXCLUDED.rarity,
       layout           = EXCLUDED.layout,
       mana_cost        = EXCLUDED.mana_cost,
       cmc              = EXCLUDED.cmc,
       type_line        = EXCLUDED.type_line,
       oracle_text      = EXCLUDED.oracle_text,
       colors           = EXCLUDED.colors,
       color_identity   = EXCLUDED.color_identity,
       finishes         = EXCLUDED.finishes,
       images           = EXCLUDED.images,
       faces            = EXCLUDED.faces,
       price_eur        = EXCLUDED.price_eur,
       price_eur_foil   = EXCLUDED.price_eur_foil,
       price_usd        = EXCLUDED.price_usd,
       price_usd_foil   = EXCLUDED.price_usd_foil,
       price_usd_etched = EXCLUDED.price_usd_etched,
       cardmarket_id    = EXCLUDED.cardmarket_id,
       cardmarket_url   = EXCLUDED.cardmarket_url,
       released_at      = EXCLUDED.released_at,
       gone_since       = NULL,
       updated_at       = now();

-- name: MarkGoneCards :execrows
-- Cards that weren't in this import: Scryfall deleted or merged them, made them digital-only,
-- or they couldn't be read. Their prices are cleared so no total keeps using a frozen price;
-- the rows stay, as collections may refer to them.
UPDATE cards c
   SET gone_since = now(), price_eur = NULL, price_eur_foil = NULL, price_usd = NULL,
       price_usd_foil = NULL, price_usd_etched = NULL, updated_at = now()
 WHERE c.gone_since IS NULL
   AND NOT EXISTS (SELECT FROM cards_staging s WHERE s.id = c.id);

-- name: StartSync :one
INSERT INTO scryfall_syncs (bulk_updated_at)
VALUES ($1)
RETURNING id;

-- name: FinishSync :exec
UPDATE scryfall_syncs
   SET finished_at   = now(),
       sets_seen     = $2,
       cards_seen    = $3,
       cards_skipped = $4,
       cards_changed = $5,
       cards_gone    = $6,
       error         = $7
 WHERE id = $1;

-- name: LastImport :one
-- The most recent import that read a bulk file and succeeded.
SELECT *
  FROM scryfall_syncs
 WHERE finished_at IS NOT NULL AND error IS NULL
 ORDER BY finished_at DESC
 LIMIT 1;

-- name: FailedImportsOf :one
-- How many imports of this bulk file have failed (or never finished).
SELECT count(*)
  FROM scryfall_syncs
 WHERE bulk_updated_at = $1 AND (error IS NOT NULL OR finished_at IS NULL);
