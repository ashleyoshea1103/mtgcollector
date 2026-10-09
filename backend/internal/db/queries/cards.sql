-- Queries for the card API (internal/cards search.go). Patterns are ILIKE patterns built there, with the user's % _ \ escaped.

-- name: SearchCardsByName :many
-- One printing per card (oracle_id) whose name matches: an English one if there is, the
-- newest. Name searches and set browsing are separate queries, each led by a condition its
-- index can serve (the name's trigram index; the set's index): a combined "pattern is null
-- or name matches" would leave a cached generic plan unable to use either.
SELECT sqlc.embed(v)
  FROM card_listing v
 WHERE v.id = ANY (
       SELECT DISTINCT ON (c.oracle_id) c.id
         FROM cards c
        WHERE c.name ILIKE @name_pattern::text
          AND c.name ILIKE ALL (@more_name_patterns::text[])
          AND c.gone_since IS NULL
          AND (@include_extras::boolean OR c.layout <> ALL (@extra_layouts::text[]))
          AND (sqlc.narg(set_code)::text IS NULL OR c.set_code = sqlc.narg(set_code)::text)
          AND (sqlc.narg(rarity)::text IS NULL OR c.rarity = sqlc.narg(rarity)::text)
          AND c.type_line ILIKE ALL (@type_patterns::text[])
          AND c.colors @> @colors::text[]
          AND (NOT @colorless::boolean OR c.colors = '{}')
        ORDER BY c.oracle_id, (c.lang = 'en') DESC, c.released_at DESC, c.set_code, c.collector_number, c.id)
 -- The exact name first, then names that start with it.
 ORDER BY (lower(v.name) = lower(@exact_name::text)) DESC, (v.name ILIKE @prefix_pattern::text) DESC, v.name, v.oracle_id
 LIMIT @row_limit OFFSET @row_offset;

-- name: SearchCardsInSet :many
SELECT sqlc.embed(v)
  FROM card_listing v
 WHERE v.id = ANY (
       SELECT DISTINCT ON (c.oracle_id) c.id
         FROM cards c
        WHERE c.set_code = @set_code::text
          AND c.gone_since IS NULL
          AND (@include_extras::boolean OR c.layout <> ALL (@extra_layouts::text[]))
          AND (sqlc.narg(rarity)::text IS NULL OR c.rarity = sqlc.narg(rarity)::text)
          AND c.type_line ILIKE ALL (@type_patterns::text[])
          AND c.colors @> @colors::text[]
          AND (NOT @colorless::boolean OR c.colors = '{}')
        ORDER BY c.oracle_id, (c.lang = 'en') DESC, c.released_at DESC, c.collector_number, c.id)
 ORDER BY v.name, v.oracle_id
 LIMIT @row_limit OFFSET @row_offset;

-- name: AutocompleteNames :many
-- Distinct names containing the pattern: names that start with it first, then ones with a
-- word that does, then the rest; within each, cards with more printings (a rough measure
-- of how well known they are) first.
SELECT name
  FROM cards
 WHERE name ILIKE @name_pattern::text
   AND gone_since IS NULL
   AND layout <> ALL (@extra_layouts::text[])
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
