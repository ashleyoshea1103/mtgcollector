-- +goose Up
-- Each user's own groups of cards: binders, decks, boxes (internal/collection).
CREATE TABLE custom_groups (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),   -- contract.MaxGroupNameLength
    kind        text NOT NULL CHECK (kind IN ('binder', 'deck', 'box', 'other')),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id) -- for group_members' foreign key, which makes a member its group's owner's
);
-- One group of a name per user, whatever its case.
CREATE UNIQUE INDEX custom_groups_user_name ON custom_groups (user_id, lower(name));

ALTER TABLE collection_entries ADD CONSTRAINT collection_entries_id_user_id UNIQUE (id, user_id);

-- The entries in each group. A binder can hold some of an entry's copies, and one entry can be
-- in several groups (a deck lists cards that live in a binder), so each member has its own
-- quantity, from 1 to its entry's.
CREATE TABLE group_members (
    group_id bigint NOT NULL,
    entry_id bigint NOT NULL,
    -- The owner of both: the foreign keys make a member's group and entry the same user's.
    user_id  bigint NOT NULL,
    quantity integer NOT NULL CHECK (quantity >= 1),
    added_at timestamptz NOT NULL DEFAULT now(), -- when it joined the group
    PRIMARY KEY (group_id, entry_id),
    FOREIGN KEY (group_id, user_id) REFERENCES custom_groups (id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id, user_id) REFERENCES collection_entries (id, user_id) ON DELETE CASCADE
);
CREATE INDEX group_members_entry_id ON group_members (entry_id);

-- A member never holds more copies than its entry has. Setting a member reads its entry FOR
-- SHARE, so it waits for a change to the entry to commit and sees the new quantity; and
-- lowering an entry's quantity lowers its members' with it. (The service checks first and says
-- so, so these only come into play when the two happen at the same moment.)
-- +goose StatementBegin
CREATE FUNCTION group_members_fit_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.quantity := least(NEW.quantity,
                          (SELECT quantity FROM collection_entries WHERE id = NEW.entry_id FOR SHARE));
    RETURN NEW;
END $$;
-- +goose StatementEnd
CREATE TRIGGER group_members_fit_entry BEFORE INSERT OR UPDATE OF quantity, entry_id ON group_members
    FOR EACH ROW EXECUTE FUNCTION group_members_fit_entry();

-- +goose StatementBegin
CREATE FUNCTION collection_entries_shrink_members() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE group_members SET quantity = NEW.quantity WHERE entry_id = NEW.id AND quantity > NEW.quantity;
    RETURN NULL;
END $$;
-- +goose StatementEnd
CREATE TRIGGER collection_entries_shrink_members AFTER UPDATE OF quantity ON collection_entries
    FOR EACH ROW WHEN (NEW.quantity < OLD.quantity) EXECUTE FUNCTION collection_entries_shrink_members();

-- What the collection's and the groups' listings read: the collection's entries (group 0), and
-- each group's members (their group's id), each with its card's grouping and pricing columns.
-- count and count_value are the copies listed: an entry's own, or the member's. listed_at is
-- when it was added: to the collection, or to the group. A query for one group_id reads only
-- that part (Postgres skips the other for a constant group 0, and finds a group's members by
-- its key), so one set of queries serves both.
CREATE VIEW listing_rows AS
SELECT 0::bigint AS group_id, p.id, p.user_id, p.card_id, p.quantity, p.finish, p.condition, p.language,
       p.added_at, p.name, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc, p.unit_price, p.value,
       p.quantity AS count, p.value AS count_value, p.added_at AS listed_at
  FROM entry_prices p
UNION ALL
SELECT m.group_id, p.id, p.user_id, p.card_id, p.quantity, p.finish, p.condition, p.language,
       p.added_at, p.name, p.set_code, p.color_identity, p.type_line, p.rarity, p.cmc, p.unit_price, p.value,
       m.quantity, line_value(p.unit_price, m.quantity), m.added_at
  FROM group_members m
  JOIN entry_prices p ON p.id = m.entry_id;

-- +goose Down
DROP VIEW listing_rows;
DROP TRIGGER collection_entries_shrink_members ON collection_entries;
DROP FUNCTION collection_entries_shrink_members;
DROP TABLE group_members;
DROP FUNCTION group_members_fit_entry;
ALTER TABLE collection_entries DROP CONSTRAINT collection_entries_id_user_id;
DROP TABLE custom_groups;
