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
-- Changes only what's given, so two changes at once don't undo each other.
UPDATE custom_groups
   SET name = coalesce(sqlc.narg(name), name),
       kind = coalesce(sqlc.narg(kind), kind),
       description = coalesce(sqlc.narg(description), description)
 WHERE user_id = @user_id AND id = @id
RETURNING id;

-- name: DeleteGroup :execrows
-- Its members go with it; the entries stay in the collection.
DELETE FROM custom_groups WHERE user_id = @user_id AND id = @id;

-- name: GroupExists :one
SELECT EXISTS (SELECT 1 FROM custom_groups WHERE user_id = @user_id AND id = @id);

-- name: ListGroups :many
-- The user's groups (or the one with group_id), by name, with their totals (of the copies in
-- each, priced as the collection's are) and previews: the small images of up to four of its
-- cards, most valuable first, each card once. Totals and previews are worked out for all the
-- groups at once, not group by group, which would read the user's entries once per group.
WITH totals AS (
    SELECT m.group_id,
           sum(m.quantity)::integer AS card_count,
           sum(line_value(p.unit_price, m.quantity))::numeric AS value_eur,
           coalesce(sum(m.quantity) FILTER (WHERE p.unit_price IS NULL), 0)::integer AS unpriced_count
      FROM group_members m
      JOIN entry_prices p ON p.id = m.entry_id
     WHERE m.user_id = @user_id
       AND (sqlc.narg(group_id)::bigint IS NULL OR m.group_id = sqlc.narg(group_id)::bigint)
     GROUP BY m.group_id
), previews AS (
    SELECT r.group_id, array_agg(r.small ORDER BY r.rank) AS images
      FROM (SELECT d.group_id, d.small,
                   row_number() OVER (PARTITION BY d.group_id
                                      ORDER BY d.unit_price DESC NULLS LAST, d.added_at, d.card_id) AS rank
              FROM (SELECT DISTINCT ON (m.group_id, p.card_id)
                           m.group_id, p.card_id, c.images ->> 'small' AS small, p.unit_price, m.added_at
                      FROM group_members m
                      JOIN entry_prices p ON p.id = m.entry_id
                      JOIN cards c ON c.id = p.card_id
                     WHERE m.user_id = @user_id
                       AND (sqlc.narg(group_id)::bigint IS NULL OR m.group_id = sqlc.narg(group_id)::bigint)
                       AND c.images ->> 'small' <> ''
                     ORDER BY m.group_id, p.card_id, p.unit_price DESC NULLS LAST, m.added_at) d) r
     WHERE r.rank <= 4
     GROUP BY r.group_id
)
SELECT g.id, g.name, g.kind, g.description,
       coalesce(t.card_count, 0)::integer AS card_count,
       coalesce(t.value_eur, 0)::numeric AS value_eur,
       coalesce(t.unpriced_count, 0)::integer AS unpriced_count,
       coalesce(pv.images, '{}')::text[] AS preview_images
  FROM custom_groups g
  LEFT JOIN totals t ON t.group_id = g.id
  LEFT JOIN previews pv ON pv.group_id = g.id
 WHERE g.user_id = @user_id
   AND (sqlc.narg(group_id)::bigint IS NULL OR g.id = sqlc.narg(group_id)::bigint)
 ORDER BY g.name COLLATE "unicode", g.id;

-- name: SetMember :one
-- Puts quantity copies of one of the user's entries in one of their groups (or sets how many
-- are there). Reads the entry FOR SHARE first, so a change to its quantity can't slip in
-- between, then the group FOR KEY SHARE, so a delete of it either finishes first (and there's
-- no group) or waits. No row when there's no such group or entry, the entry has fewer copies,
-- or it would be a new member and the user already has max_members (approximate, as
-- max_groups).
WITH entry AS (
    SELECT e.id, e.quantity
      FROM collection_entries e
     WHERE e.id = @entry_id AND e.user_id = @user_id
       FOR SHARE
), grp AS (
    SELECT g.id, g.user_id
      FROM custom_groups g
     WHERE g.id = @group_id AND g.user_id = @user_id
       FOR KEY SHARE
)
INSERT INTO group_members AS m (group_id, entry_id, user_id, quantity)
SELECT grp.id, entry.id, grp.user_id, @quantity
  FROM entry, grp
 WHERE entry.quantity >= @quantity::integer
   AND ((SELECT count(*) FROM group_members c WHERE c.user_id = @user_id) < @max_members::integer
        OR EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = @group_id AND x.entry_id = @entry_id))
ON CONFLICT (group_id, entry_id) DO UPDATE SET quantity = excluded.quantity
RETURNING (xmax = 0)::boolean AS created;

-- name: AddToGroup :execrows
-- Puts copies just added to an entry in a group too (or more of them, if they're there): never
-- more than the entry has. Reads the group FOR KEY SHARE, as SetMember. No row when there's no
-- such group (deleted meanwhile), or it would be a new member and the user already has
-- max_members.
WITH grp AS (
    SELECT g.id, g.user_id
      FROM custom_groups g
     WHERE g.id = @group_id AND g.user_id = @user_id
       FOR KEY SHARE
)
INSERT INTO group_members AS m (group_id, entry_id, user_id, quantity)
SELECT grp.id, e.id, grp.user_id, least(@quantity::integer, e.quantity)
  FROM grp, collection_entries e
 WHERE e.id = @entry_id AND e.user_id = @user_id
   AND ((SELECT count(*) FROM group_members c WHERE c.user_id = @user_id) < @max_members::integer
        OR EXISTS (SELECT 1 FROM group_members x WHERE x.group_id = @group_id AND x.entry_id = @entry_id))
ON CONFLICT (group_id, entry_id) DO UPDATE SET quantity = least(m.quantity + excluded.quantity,
    (SELECT quantity FROM collection_entries WHERE id = excluded.entry_id));

-- name: HasMember :one
SELECT EXISTS (SELECT 1 FROM group_members WHERE user_id = @user_id AND group_id = @group_id AND entry_id = @entry_id);

-- name: RemoveMember :execrows
DELETE FROM group_members WHERE user_id = @user_id AND group_id = @group_id AND entry_id = @entry_id;

-- name: EntryQuantity :one
-- How many copies one of the user's entries has.
SELECT quantity FROM collection_entries WHERE user_id = @user_id AND id = @id;
