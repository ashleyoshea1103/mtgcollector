-- +goose Up
-- What the card API reads: every printing with its set's name and symbol. One shape for
-- search results, printings and card details (internal/cards search.go). Postgres won't
-- change the type of a column a view uses: a later migration that does must drop this view
-- and create it again.
CREATE VIEW card_listing AS
SELECT c.id, c.oracle_id, c.name, c.lang, c.set_code, c.collector_number, c.rarity, c.layout,
       c.mana_cost, c.cmc, c.type_line, c.oracle_text, c.colors, c.color_identity, c.finishes,
       c.images, c.faces, c.price_eur, c.price_eur_foil, c.price_usd, c.price_usd_foil,
       c.price_usd_etched, c.cardmarket_url, c.released_at, c.gone_since,
       s.name AS set_name, s.icon_svg_uri AS set_icon_svg_uri
  FROM cards c
  JOIN sets s ON s.code = c.set_code;

-- +goose Down
DROP VIEW card_listing;
