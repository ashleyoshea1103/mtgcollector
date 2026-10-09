-- Queries for the card API (internal/cards search.go). Patterns are ILIKE patterns built there, with the user's % _ \ escaped.

-- name: SearchCardsByName :many
-- A page of cards whose name matches, one printing each (see search.go for which). The
-- search is led by a name pattern the trigram index can serve; set browsing is a separate
-- query led by the set's index. The ranking and paging are done on narrow rows, and only
-- the page's cards are then read in full.
WITH picked AS (
    SELECT DISTINCT ON (c.oracle_id) c.id, c.name, c.oracle_id
      FROM cards c
      JOIN sets s ON s.code = c.set_code
     WHERE c.name ILIKE @lead_pattern::text
       AND c.name ILIKE ALL (@name_patterns::text[])
       AND c.gone_since IS NULL
       AND (@include_extras::boolean
            OR (c.layout <> ALL (@extra_layouts::text[]) AND NOT c.type_line ILIKE ANY (@extra_types::text[])))
       AND (sqlc.narg(set_code)::text IS NULL OR c.set_code = sqlc.narg(set_code)::text)
       AND (sqlc.narg(rarity)::text IS NULL OR c.rarity = sqlc.narg(rarity)::text)
       AND c.type_line ILIKE ALL (@type_patterns::text[])
       AND c.colors @> @colors::text[]
       AND (NOT @colorless::boolean OR c.colors = '{}')
     ORDER BY c.oracle_id,
              (c.lang = 'en') DESC,
              (c.released_at <= current_date) DESC,
              (s.set_type = ANY (@regular_set_types::text[])) DESC,
              c.released_at DESC, c.set_code, length(c.collector_number), c.collector_number, c.id
), page AS (
    -- Names that start with what was typed first (the exact name among them, as it's shortest).
    SELECT p.id, p.name, p.oracle_id, (p.name ILIKE @prefix_pattern::text) AS starts_with
      FROM picked p
     ORDER BY starts_with DESC, p.name, p.oracle_id
     LIMIT @row_limit OFFSET @row_offset
)
SELECT sqlc.embed(v)
  FROM page
  JOIN card_listing v ON v.id = page.id
 ORDER BY page.starts_with DESC, page.name, page.oracle_id;

-- name: SearchCardsInSet :many
-- A page of the cards in a set, by name, one printing each (the set's own), optionally
-- narrowed by name words too short to lead a name search.
WITH picked AS (
    SELECT DISTINCT ON (c.oracle_id) c.id, c.name, c.oracle_id
      FROM cards c
     WHERE c.set_code = @set_code::text
       AND c.name ILIKE ALL (@name_patterns::text[])
       AND c.gone_since IS NULL
       AND (@include_extras::boolean
            OR (c.layout <> ALL (@extra_layouts::text[]) AND NOT c.type_line ILIKE ANY (@extra_types::text[])))
       AND (sqlc.narg(rarity)::text IS NULL OR c.rarity = sqlc.narg(rarity)::text)
       AND c.type_line ILIKE ALL (@type_patterns::text[])
       AND c.colors @> @colors::text[]
       AND (NOT @colorless::boolean OR c.colors = '{}')
     ORDER BY c.oracle_id,
              (c.lang = 'en') DESC,
              (c.released_at <= current_date) DESC,
              c.released_at DESC, length(c.collector_number), c.collector_number, c.id
), page AS (
    SELECT p.id, p.name, p.oracle_id
      FROM picked p
     ORDER BY p.name, p.oracle_id
     LIMIT @row_limit OFFSET @row_offset
)
SELECT sqlc.embed(v)
  FROM page
  JOIN card_listing v ON v.id = page.id
 ORDER BY page.name, page.oracle_id;

-- name: AutocompleteNames :many
-- Distinct names containing the pattern: names that start with it first, then ones with a
-- word that does, then the rest; within each, cards with more printings (a rough measure
-- of how well known they are) first.
SELECT name
  FROM cards
 WHERE name ILIKE @name_pattern::text
   AND gone_since IS NULL
   AND layout <> ALL (@extra_layouts::text[])
   AND NOT type_line ILIKE ANY (@extra_types::text[])
 GROUP BY name
 ORDER BY (name ILIKE @prefix_pattern::text) DESC,
          ((' ' || name) ILIKE @word_prefix_pattern::text) DESC,
          count(*) DESC,
          name
 LIMIT @row_limit;

-- name: GetCard :one
SELECT sqlc.embed(v)
  FROM card_listing v
 WHERE v.id = @id;

-- name: CardOracleID :one
SELECT oracle_id FROM cards WHERE id = @id;

-- name: CardPrintings :many
-- Every printing of the card with this oracle id, newest first, gone ones included (a
-- collection may hold them).
SELECT sqlc.embed(v)
  FROM card_listing v
 WHERE v.oracle_id = @oracle_id
 ORDER BY v.released_at DESC, v.set_code, length(v.collector_number), v.collector_number, v.id
 LIMIT @row_limit OFFSET @row_offset;
