-- +goose Up
-- Scryfall's data, imported daily from its bulk files (internal/scryfall, internal/cards).

-- Every Scryfall set, so a card's set can be shown properly (name, symbol), not just its code.
CREATE TABLE sets (
    code            text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{1,8}$'), -- Scryfall's set code, e.g. 'mh2'
    scryfall_id     uuid NOT NULL UNIQUE,       -- stays the same if Scryfall renames the code
    name            text NOT NULL,
    set_type        text NOT NULL,              -- 'expansion', 'core', 'promo', ...
    released_at     date,
    icon_svg_uri    text,                       -- only https://svgs.scryfall.io/ URLs; null otherwise
    parent_set_code text,                       -- e.g. a promo set's main set; not a foreign key, as
                                                -- the parent may be digital-only and not imported
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per paper printing (Scryfall card object). Digital-only printings aren't imported.
CREATE TABLE cards (
    id               uuid PRIMARY KEY,           -- Scryfall's printing id
    oracle_id        uuid NOT NULL,              -- the same for every printing of a card
    name             text NOT NULL,
    lang             text NOT NULL CHECK (lang ~ '^[a-z]{2,3}$'),
    set_code         text NOT NULL REFERENCES sets (code) ON UPDATE CASCADE,
    collector_number text NOT NULL CHECK (length(collector_number) BETWEEN 1 AND 16), -- e.g. '146', '381★'
    rarity           text NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'mythic', 'special', 'bonus')),
    layout           text NOT NULL,
    mana_cost        text NOT NULL,
    cmc              numeric NOT NULL,           -- usually whole, but e.g. 0.5 exists
    type_line        text NOT NULL,
    oracle_text      text,
    colors           text[] NOT NULL,
    color_identity   text[] NOT NULL,
    finishes         text[] NOT NULL CHECK (finishes <> '{}' AND finishes <@ ARRAY['nonfoil', 'foil', 'etched']),
    images           jsonb,                      -- contract.CardImages, or null
    faces            jsonb,                      -- []contract.CardFace, or null
    price_eur        numeric(10, 2),             -- Cardmarket, via Scryfall
    price_eur_foil   numeric(10, 2),
    price_usd        numeric(10, 2),
    price_usd_foil   numeric(10, 2),
    price_usd_etched numeric(10, 2),
    cardmarket_id    integer,
    cardmarket_url   text,                       -- only https://www.cardmarket.com/ URLs; null otherwise
    released_at      date NOT NULL,
    -- When the card stopped appearing in Scryfall's bulk file (deleted, merged, made digital,
    -- or no longer readable); its prices are cleared then, so no total uses a frozen price.
    -- The row stays, as collections may refer to it. Null while it's in the file.
    gone_since       timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_name_trgm ON cards USING gin (name gin_trgm_ops);
CREATE INDEX cards_oracle_id ON cards (oracle_id);
-- Not unique: Scryfall's id is the identity, and a renumbered printing mustn't fail an import.
CREATE INDEX cards_set_number ON cards (set_code, collector_number);

-- Where an import loads cards (during the download, outside any transaction) before merging
-- them into `cards` in one short transaction. Unlogged: its contents only matter during one
-- import, and imports never overlap (they hold an advisory lock).
CREATE UNLOGGED TABLE cards_staging (LIKE cards INCLUDING DEFAULTS);
-- Not unique (the bulk file could repeat a card); the merge and the gone-card checks look
-- staged cards up by id, which without this compares every card with every other.
CREATE INDEX cards_staging_id ON cards_staging (id);

-- One row per import attempt.
CREATE TABLE scryfall_syncs (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,                -- null while running, or if the process died
    bulk_updated_at timestamptz,                -- the bulk file's own updated_at, from Scryfall
    sets_seen       integer,
    cards_seen      integer,                    -- paper printings read from the bulk file
    cards_skipped   integer,                    -- of those, ones that couldn't be imported
    cards_changed   integer,                    -- inserted, or updated because something changed
    cards_gone      integer,                    -- no longer in the file: marked gone, prices cleared
    error           text                        -- null if it succeeded
);

-- +goose Down
DROP TABLE scryfall_syncs;
DROP TABLE cards_staging;
DROP TABLE cards;
DROP TABLE sets;
