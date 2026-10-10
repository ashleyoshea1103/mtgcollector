-- +goose Up
-- The cards each user owns (internal/collection): one row per printing, finish, condition
-- and language, with how many copies.
CREATE TABLE collection_entries (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Cards are never deleted (the import marks them gone_since instead), so an entry's card
    -- is always there.
    card_id   uuid NOT NULL REFERENCES cards (id),
    quantity  integer NOT NULL CHECK (quantity BETWEEN 1 AND 999), -- contract.MaxQuantity
    finish    text NOT NULL CHECK (finish IN ('nonfoil', 'foil', 'etched')),
    condition text NOT NULL CHECK (condition IN ('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO')),
    language  text NOT NULL CHECK (language ~ '^[a-z]{2,3}$'),   -- one of contract.Language
    added_at  timestamptz NOT NULL DEFAULT now(),
    -- Adding the same card again adds to its quantity. (Also the index for a user's entries.)
    UNIQUE (user_id, card_id, finish, condition, language)
);
CREATE INDEX collection_entries_card_id ON collection_entries (card_id);

-- The EUR price of one copy in a finish (testdata/pricing-cases.json): non-foil, the regular
-- price; foil and etched, the foil price, else the regular one (Scryfall has no EUR etched
-- price). Null when there's none, as for a card no longer listed, whose prices are cleared.
CREATE FUNCTION unit_price_eur(finish text, eur numeric, eur_foil numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE WHEN finish = 'nonfoil' THEN eur ELSE coalesce(eur_foil, eur) END;

-- quantity × unit price, in cents (half away from zero, as the frontend's roundToCents).
CREATE FUNCTION line_value(unit_price numeric, quantity integer) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN round(unit_price * quantity, 2);

-- The group a card falls in when the collection is grouped (contract.GroupBy). The keys:
--   set     the set code
--   color   W, U, B, R or G for one colour of identity, M for several, C for none
--   type    the first of creature, planeswalker, battle, instant, sorcery, artifact,
--           enchantment, land in the front face's card types; else other
--   rarity  the rarity
--   cmc     the mana value, rounded down, 0 to 6; 7 for 7 or more
--   none    all
CREATE FUNCTION card_group(group_by text, set_code text, color_identity text[], type_line text,
                           rarity text, cmc numeric) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    RETURN CASE group_by
        WHEN 'set' THEN set_code
        WHEN 'color' THEN CASE cardinality(color_identity) WHEN 0 THEN 'C' WHEN 1 THEN color_identity[1] ELSE 'M' END
        WHEN 'type' THEN coalesce((
            SELECT u.type
              FROM unnest(ARRAY['creature', 'planeswalker', 'battle', 'instant', 'sorcery',
                                'artifact', 'enchantment', 'land']) WITH ORDINALITY AS u (type, rank)
             -- The words before the dash ("Legendary Artifact Creature — Elf") of the front face.
             WHERE u.type = ANY (string_to_array(lower(split_part(split_part(type_line, ' // ', 1), ' — ', 1)), ' '))
             ORDER BY u.rank
             LIMIT 1), 'other')
        WHEN 'rarity' THEN rarity
        WHEN 'cmc' THEN least(floor(cmc), 7)::integer::text
        ELSE 'all'
    END;

-- +goose Down
DROP FUNCTION card_group;
DROP FUNCTION line_value;
DROP FUNCTION unit_price_eur;
DROP TABLE collection_entries;
