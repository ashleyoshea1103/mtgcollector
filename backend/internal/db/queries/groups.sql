-- Queries for custom groups (internal/collection customgroups.go): binders, decks and boxes,
-- and their members. Every one is for one user's: user_id is in its WHERE clause.

-- name: CreateGroup :one
-- No row when the user already has max_groups groups. (Approximate: creations at the same
-- moment can each see room.) A name the user already has is a unique violation.
INSERT INTO custom_groups (user_id, name, kind, description)
SELECT @user_id, @name, @kind, @description
 WHERE (SELECT count(*) FROM custom_groups WHERE user_id = @user_id) < @max_groups::integer
RETURNING id;

-- name: UpdateGroup :one
UPDATE custom_groups SET name = @name, kind = @kind, description = @description
 WHERE user_id = @user_id AND id = @id
RETURNING id;

-- name: DeleteGroup :execrows
-- Its members go with it; the entries stay in the collection.
DELETE FROM custom_groups WHERE user_id = @user_id AND id = @id;

-- name: GroupExists :one
SELECT EXISTS (SELECT 1 FROM custom_groups WHERE user_id = @user_id AND id = @id);

-- name: ListGroups :many
-- The user's groups (or the one with group_id), by name, with their totals: of the copies in
-- each, priced as the collection's are.
SELECT g.id, g.name, g.kind, g.description,
       coalesce(sum(m.quantity), 0)::integer AS card_count,
       coalesce(sum(line_value(p.unit_price, m.quantity)), 0)::numeric AS value_eur,
       coalesce(sum(m.quantity) FILTER (WHERE m.entry_id IS NOT NULL AND p.unit_price IS NULL), 0)::integer AS unpriced_count
  FROM custom_groups g
  LEFT JOIN group_members m ON m.group_id = g.id
  LEFT JOIN entry_prices p ON p.id = m.entry_id
 WHERE g.user_id = @user_id
   AND (sqlc.narg(group_id)::bigint IS NULL OR g.id = sqlc.narg(group_id)::bigint)
 GROUP BY g.id
 ORDER BY g.name COLLATE "unicode", g.id;

-- name: GroupPreviews :many
-- Up to four card images for each of the user's groups (or the one with group_id): its most
-- valuable cards', each card once.
SELECT x.group_id, x.images
  FROM (SELECT d.group_id, d.images,
               row_number() OVER (PARTITION BY d.group_id
                                  ORDER BY d.unit_price DESC NULLS LAST, d.added_at, d.card_id) AS n
          FROM (SELECT DISTINCT ON (m.group_id, p.card_id) m.group_id, p.card_id, c.images, p.unit_price, m.added_at
                  FROM group_members m
                  JOIN entry_prices p ON p.id = m.entry_id
                  JOIN cards c ON c.id = p.card_id
                 WHERE m.user_id = @user_id
                   AND (sqlc.narg(group_id)::bigint IS NULL OR m.group_id = sqlc.narg(group_id)::bigint)
                   AND c.images IS NOT NULL
                 ORDER BY m.group_id, p.card_id, p.unit_price DESC NULLS LAST, m.added_at) d) x
 WHERE x.n <= 4
 ORDER BY x.group_id, x.n;

-- name: SetMember :one
-- Puts quantity copies of one of the user's entries in one of their groups (or sets how many
-- are there). Reads the entry FOR SHARE first, so a change to its quantity can't slip in
-- between. No row when there's no such group or entry, or the entry has fewer copies.
WITH entry AS (
    SELECT e.id, e.quantity
      FROM collection_entries e
     WHERE e.id = @entry_id AND e.user_id = @user_id
       FOR SHARE
)
INSERT INTO group_members AS m (group_id, entry_id, user_id, quantity)
SELECT g.id, entry.id, g.user_id, @quantity
  FROM entry, custom_groups g
 WHERE g.id = @group_id AND g.user_id = @user_id AND entry.quantity >= @quantity::integer
ON CONFLICT (group_id, entry_id) DO UPDATE SET quantity = excluded.quantity
RETURNING (xmax = 0)::boolean AS created;

-- name: AddToGroup :exec
-- Puts copies just added to an entry in a group too (or more of them, if they're there): never
-- more than the entry has.
INSERT INTO group_members AS m (group_id, entry_id, user_id, quantity)
SELECT g.id, e.id, g.user_id, least(@quantity::integer, e.quantity)
  FROM custom_groups g, collection_entries e
 WHERE g.id = @group_id AND g.user_id = @user_id AND e.id = @entry_id AND e.user_id = @user_id
ON CONFLICT (group_id, entry_id) DO UPDATE SET quantity = least(m.quantity + excluded.quantity,
    (SELECT quantity FROM collection_entries WHERE id = excluded.entry_id));

-- name: RemoveMember :execrows
DELETE FROM group_members WHERE user_id = @user_id AND group_id = @group_id AND entry_id = @entry_id;

-- name: EntryQuantity :one
-- How many copies one of the user's entries has.
SELECT quantity FROM collection_entries WHERE user_id = @user_id AND id = @id;
