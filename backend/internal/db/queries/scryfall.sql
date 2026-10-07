-- Queries for the Scryfall import (internal/cards).

-- name: UpsertSets :batchexec
-- Inserts a set, or updates it if anything about it changed. Sent as one batch for all sets.
INSERT INTO sets (code, scryfall_id, name, set_type, released_at, icon_svg_uri, parent_set_code)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (code) DO UPDATE
   SET scryfall_id     = EXCLUDED.scryfall_id,
       name            = EXCLUDED.name,
       set_type        = EXCLUDED.set_type,
       released_at     = EXCLUDED.released_at,
       icon_svg_uri    = EXCLUDED.icon_svg_uri,
       parent_set_code = EXCLUDED.parent_set_code,
       updated_at      = now()
 WHERE (sets.scryfall_id, sets.name, sets.set_type, sets.released_at, sets.icon_svg_uri, sets.parent_set_code)
       IS DISTINCT FROM
       (EXCLUDED.scryfall_id, EXCLUDED.name, EXCLUDED.set_type, EXCLUDED.released_at, EXCLUDED.icon_svg_uri, EXCLUDED.parent_set_code);

-- name: ClearStagedCards :exec
TRUNCATE cards_staging;

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

-- name: MergeStagedCards :execrows
-- Moves the staged cards into cards: new ones are inserted, and existing ones are updated
-- only if something changed, so a daily import rewrites just the cards whose prices moved.
-- Returns how many cards were inserted or updated.
INSERT INTO cards (
    id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
    type_line, oracle_text, colors, color_identity, finishes, images, faces,
    price_eur, price_eur_foil, price_usd, price_usd_foil, price_usd_etched,
    cardmarket_id, cardmarket_url, released_at
)
SELECT DISTINCT ON (id)
    id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
    type_line, oracle_text, colors, color_identity, finishes, images, faces,
    price_eur, price_eur_foil, price_usd, price_usd_foil, price_usd_etched,
    cardmarket_id, cardmarket_url, released_at
  FROM cards_staging
 ORDER BY id
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
       updated_at       = now()
 WHERE (cards.oracle_id, cards.name, cards.lang, cards.set_code, cards.collector_number, cards.rarity,
        cards.layout, cards.mana_cost, cards.cmc, cards.type_line, cards.oracle_text, cards.colors,
        cards.color_identity, cards.finishes, cards.images, cards.faces, cards.price_eur,
        cards.price_eur_foil, cards.price_usd, cards.price_usd_foil, cards.price_usd_etched,
        cards.cardmarket_id, cards.cardmarket_url, cards.released_at)
       IS DISTINCT FROM
       (EXCLUDED.oracle_id, EXCLUDED.name, EXCLUDED.lang, EXCLUDED.set_code, EXCLUDED.collector_number,
        EXCLUDED.rarity, EXCLUDED.layout, EXCLUDED.mana_cost, EXCLUDED.cmc, EXCLUDED.type_line,
        EXCLUDED.oracle_text, EXCLUDED.colors, EXCLUDED.color_identity, EXCLUDED.finishes,
        EXCLUDED.images, EXCLUDED.faces, EXCLUDED.price_eur, EXCLUDED.price_eur_foil, EXCLUDED.price_usd,
        EXCLUDED.price_usd_foil, EXCLUDED.price_usd_etched, EXCLUDED.cardmarket_id,
        EXCLUDED.cardmarket_url, EXCLUDED.released_at);

-- name: StartSync :one
INSERT INTO scryfall_syncs DEFAULT VALUES
RETURNING id;

-- name: FinishSync :exec
UPDATE scryfall_syncs
   SET finished_at     = now(),
       bulk_updated_at = $2,
       sets_seen       = $3,
       cards_seen      = $4,
       cards_skipped   = $5,
       cards_changed   = $6,
       error           = $7
 WHERE id = $1;

-- name: LastSuccessfulSync :one
-- The most recent import that finished without an error (including ones that found the
-- bulk file unchanged and imported nothing).
SELECT *
  FROM scryfall_syncs
 WHERE finished_at IS NOT NULL AND error IS NULL
 ORDER BY finished_at DESC
 LIMIT 1;
