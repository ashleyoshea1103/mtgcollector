package collection

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

var (
	ErrGroupNotFound  = apperr.New(apperr.NotFound, "no such group")
	ErrMemberNotFound = apperr.New(apperr.NotFound, "that entry isn't in this group")
)

func (s *Service) maxMembers() int {
	if s.MaxMembers > 0 {
		return s.MaxMembers
	}
	return contract.MaxMembers
}

func (s *Service) maxGroups() int {
	if s.MaxGroups > 0 {
		return s.MaxGroups
	}
	return contract.MaxGroups
}

// ListGroups returns the user's custom groups, by name.
func (s *Service) ListGroups(ctx context.Context, userID int64) (contract.CustomGroupList, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	groups, err := s.customGroups(ctx, userID, pgtype.Int8{})
	return contract.CustomGroupList{Groups: groups}, err
}

// Group returns one of the user's custom groups.
func (s *Service) Group(ctx context.Context, userID, id int64) (contract.CustomGroup, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	return s.group(ctx, userID, id)
}

func (s *Service) group(ctx context.Context, userID, id int64) (contract.CustomGroup, error) {
	groups, err := s.customGroups(ctx, userID, pgtype.Int8{Int64: id, Valid: true})
	if err != nil {
		return contract.CustomGroup{}, err
	}
	if len(groups) == 0 {
		return contract.CustomGroup{}, ErrGroupNotFound
	}
	return groups[0], nil
}

// customGroups returns the user's groups (or the one only names), with their totals and
// previews: the stored small images of their cards, never anything a client sent.
func (s *Service) customGroups(ctx context.Context, userID int64, only pgtype.Int8) ([]contract.CustomGroup, error) {
	rows, err := s.q().ListGroups(ctx, store.ListGroupsParams{UserID: userID, GroupID: only})
	if err != nil {
		return nil, db.Error(ctx, "list groups", err)
	}
	groups := make([]contract.CustomGroup, len(rows))
	for i, r := range rows {
		groups[i] = contract.CustomGroup{
			ValueTotal: contract.ValueTotal{CardCount: int(r.CardCount), UnpricedCount: int(r.UnpricedCount)},
			ID:         r.ID, Name: r.Name, Kind: contract.CustomGroupKind(r.Kind), Description: r.Description,
			PreviewImages: r.PreviewImages,
		}
		if v := cards.Number(r.ValueEur); v != nil {
			groups[i].ValueEUR = *v
		}
		if groups[i].PreviewImages == nil {
			groups[i].PreviewImages = []string{}
		}
	}
	return groups, nil
}

// CreateGroup makes a new custom group.
func (s *Service) CreateGroup(ctx context.Context, userID int64, g contract.NewGroup) (contract.CustomGroup, error) {
	name, description, err := checkGroup(g.Name, g.Kind, g.Description)
	if err != nil {
		return contract.CustomGroup{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	id, err := s.q().CreateGroup(ctx, store.CreateGroupParams{
		UserID: userID, Name: name, Kind: string(g.Kind), Description: description, MaxGroups: int32(s.maxGroups()),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CustomGroup{}, invalid("you have %d groups, the most you can have; delete one to make another", s.maxGroups())
	}
	if err != nil {
		return contract.CustomGroup{}, groupWriteError(ctx, name, err)
	}
	return s.group(ctx, userID, id)
}

// ChangeGroup renames a group, or changes its kind or description.
func (s *Service) ChangeGroup(ctx context.Context, userID, id int64, c contract.GroupChange) (contract.CustomGroup, error) {
	if c == (contract.GroupChange{}) {
		return contract.CustomGroup{}, invalid("give at least one of name, kind and description to change")
	}
	// Only what's given is checked and written, so two changes at once don't undo each other.
	next := store.UpdateGroupParams{UserID: userID, ID: id}
	if c.Name != nil {
		name, err := checkName(*c.Name)
		if err != nil {
			return contract.CustomGroup{}, err
		}
		next.Name = pgtype.Text{String: name, Valid: true}
	}
	if c.Kind != nil {
		if err := checkEnum(*c.Kind); err != nil {
			return contract.CustomGroup{}, invalid("%s", err)
		}
		next.Kind = pgtype.Text{String: string(*c.Kind), Valid: true}
	}
	if c.Description != nil {
		description, err := checkDescription(*c.Description)
		if err != nil {
			return contract.CustomGroup{}, err
		}
		next.Description = pgtype.Text{String: description, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	_, err := s.q().UpdateGroup(ctx, next)
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CustomGroup{}, ErrGroupNotFound
	}
	if err != nil {
		return contract.CustomGroup{}, groupWriteError(ctx, next.Name.String, err)
	}
	return s.group(ctx, userID, id)
}

// groupWriteError says what went wrong saving a group: a name the user already has, or the
// database's own failure.
func groupWriteError(ctx context.Context, name string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation: custom_groups_user_name
		return apperr.New(apperr.Conflict, "you already have a group called %q", name)
	}
	return db.Error(ctx, "save group", err)
}

// DeleteGroup deletes a group. The cards in it stay in the collection.
func (s *Service) DeleteGroup(ctx context.Context, userID, id int64) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.q().DeleteGroup(ctx, store.DeleteGroupParams{UserID: userID, ID: id})
	if err != nil {
		return db.Error(ctx, "delete group", err)
	}
	if n == 0 {
		return ErrGroupNotFound
	}
	return nil
}

// GroupGroups groups a custom group's members, as Groups does the collection's entries.
func (s *Service) GroupGroups(ctx context.Context, userID, groupID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	if err := s.ownGroup(ctx, userID, groupID); err != nil {
		return contract.CollectionGroups{}, err
	}
	return s.groupsOf(ctx, userID, groupID, by)
}

// Members returns a page of a custom group's members, as Entries does the collection's
// entries. Sorting by added is by when they joined the group.
func (s *Service) Members(ctx context.Context, userID, groupID int64, q EntryQuery) (contract.GroupMemberPage, error) {
	if err := s.ownGroup(ctx, userID, groupID); err != nil {
		return contract.GroupMemberPage{}, err
	}
	q.group = groupID
	rows, next, err := s.listing(ctx, userID, q)
	if err != nil {
		return contract.GroupMemberPage{}, err
	}
	page := contract.GroupMemberPage{Members: make([]contract.GroupMember, len(rows)), NextCursor: next}
	for i, r := range rows {
		if page.Members[i], err = toMember(r.ListingRow, r.CardListing); err != nil {
			return contract.GroupMemberPage{}, err
		}
	}
	return page, nil
}

// SetMember puts quantity copies of one of the user's entries in one of their groups (or
// changes how many are there), and says whether the entry is new to the group.
func (s *Service) SetMember(ctx context.Context, userID, groupID, entryID int64, quantity int) (contract.GroupMember, bool, error) {
	if quantity < 1 || quantity > contract.MaxQuantity {
		return contract.GroupMember{}, false, invalid("quantity must be from 1 to the entry's copies")
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	created, err := s.q().SetMember(ctx, store.SetMemberParams{
		UserID: userID, GroupID: groupID, EntryID: entryID, Quantity: int32(quantity), MaxMembers: int32(s.maxMembers()),
	})
	// (A foreign key violation: the group or entry was deleted just as the member was written.)
	if errors.Is(err, pgx.ErrNoRows) || isForeignKeyViolation(err) {
		return contract.GroupMember{}, false, s.whyNotSet(ctx, userID, groupID, entryID, quantity)
	}
	if err != nil {
		return contract.GroupMember{}, false, db.Error(ctx, "set member", err)
	}
	m, err := s.member(ctx, userID, groupID, entryID)
	return m, created, err
}

// whyNotSet says why SetMember set nothing: there's no such group or entry, the entry has
// fewer copies, or the user has as many members as they can.
func (s *Service) whyNotSet(ctx context.Context, userID, groupID, entryID int64, quantity int) error {
	if err := s.ownGroup(ctx, userID, groupID); err != nil {
		return err
	}
	have, err := s.q().EntryQuantity(ctx, store.EntryQuantityParams{UserID: userID, ID: entryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return db.Error(ctx, "find entry", err)
	}
	if int(have) < quantity {
		return invalid("that entry has %d copies, so the group can hold 1 to %d of them", have, have)
	}
	return s.whyNotGrouped(ctx, s.q(), userID, groupID)
}

// whyNotGrouped says why an entry that's the user's couldn't join one of their groups: the
// group is gone, or the user has as many members as they can.
func (s *Service) whyNotGrouped(ctx context.Context, q *store.Queries, userID, groupID int64) error {
	ok, err := q.GroupExists(ctx, store.GroupExistsParams{UserID: userID, ID: groupID})
	if err != nil {
		return db.Error(ctx, "find group", err)
	}
	if !ok {
		return invalid("there's no group with that id")
	}
	return invalid("your groups hold %d entries between them, the most they can; take some out to put others in", s.maxMembers())
}

// RemoveMember takes an entry out of a group. It stays in the collection.
func (s *Service) RemoveMember(ctx context.Context, userID, groupID, entryID int64) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.q().RemoveMember(ctx, store.RemoveMemberParams{UserID: userID, GroupID: groupID, EntryID: entryID})
	if err != nil {
		return db.Error(ctx, "remove member", err)
	}
	if n == 0 {
		if err := s.ownGroup(ctx, userID, groupID); err != nil {
			return err
		}
		return ErrMemberNotFound
	}
	return nil
}

// Member returns one of a group's members: how many of the entry's copies are in it.
func (s *Service) Member(ctx context.Context, userID, groupID, entryID int64) (contract.GroupMember, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	m, err := s.member(ctx, userID, groupID, entryID)
	if errors.Is(err, ErrMemberNotFound) {
		if err := s.ownGroup(ctx, userID, groupID); err != nil {
			return contract.GroupMember{}, err
		}
	}
	return m, err
}

func (s *Service) member(ctx context.Context, userID, groupID, entryID int64) (contract.GroupMember, error) {
	row, err := s.q().GetEntry(ctx, store.GetEntryParams{GroupID: groupID, UserID: userID, ID: entryID})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.GroupMember{}, ErrMemberNotFound // removed meanwhile
	}
	if err != nil {
		return contract.GroupMember{}, db.Error(ctx, "get member", err)
	}
	return toMember(row.ListingRow, row.CardListing)
}

// ownGroup is nil if the user has a group with this id, and ErrGroupNotFound if not.
func (s *Service) ownGroup(ctx context.Context, userID, groupID int64) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ok, err := s.q().GroupExists(ctx, store.GroupExistsParams{UserID: userID, ID: groupID})
	if err != nil {
		return db.Error(ctx, "find group", err)
	}
	if !ok {
		return ErrGroupNotFound
	}
	return nil
}

// toMember is a group's member and its card as the API shows them.
func toMember(r store.ListingRow, v store.CardListing) (contract.GroupMember, error) {
	e, err := toEntry(r, v)
	if err != nil {
		return contract.GroupMember{}, err
	}
	return contract.GroupMember{
		Entry: e, Quantity: int(r.Count), ValueEUR: cards.Number(r.CountValue),
		AddedAt: r.ListedAt.Time.UTC().Format(time.RFC3339Nano),
	}, nil
}

// checkGroup checks a group's name, kind and description, and returns the name and
// description to store: with spaces trimmed from their ends.
func checkGroup(name string, kind contract.CustomGroupKind, description string) (string, string, error) {
	name, err := checkName(name)
	if err != nil {
		return "", "", err
	}
	if err := checkEnum(kind); err != nil {
		return "", "", invalid("%s", err)
	}
	description, err = checkDescription(description)
	return name, description, err
}

// checkName checks a group's name, and returns it as stored: trimmed, and in one Unicode form
// (NFC), so "Café" typed with an accent or with é is one name.
func checkName(name string) (string, error) {
	name = norm.NFC.String(strings.TrimSpace(name))
	switch n := utf8.RuneCountInString(name); {
	case n == 0:
		return "", invalid("give the group a name")
	case n > contract.MaxGroupNameLength:
		return "", invalid("a group's name can't be longer than %d characters", contract.MaxGroupNameLength)
	case !plainText(name, false) || !strings.ContainsFunc(name, visible):
		return "", invalid("a group's name needs a letter, digit or symbol, and only characters that show")
	}
	return name, nil
}

func checkDescription(description string) (string, error) {
	description = norm.NFC.String(strings.TrimSpace(description))
	if utf8.RuneCountInString(description) > contract.MaxGroupDescriptionLength {
		return "", invalid("a group's description can't be longer than %d characters", contract.MaxGroupDescriptionLength)
	}
	if !plainText(description, true) {
		return "", invalid("a group's description can only have characters that show, spaces and line breaks")
	}
	return description, nil
}

// plainText reports whether s is valid UTF-8 of characters that show (letters, marks, digits,
// punctuation, symbols) and spaces, and line breaks and tabs where lines are allowed: no
// control characters (Postgres can't store a NUL), and no invisible ones that would let
// "Binder" and a look-alike be two groups (zero-width spaces, direction overrides, private-use
// or unassigned code points). The zero-width joiner stays, as emoji sequences use it.
func plainText(s string, lines bool) bool {
	if !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		ok := unicode.In(r, unicode.L, unicode.M, unicode.N, unicode.P, unicode.S, unicode.Zs) || r == '\u200d' ||
			lines && (r == '\n' || r == '\r' || r == '\t')
		if !ok {
			return false
		}
	}
	return true
}

// visible reports whether r is a letter, digit, punctuation or symbol: something that shows.
func visible(r rune) bool { return unicode.In(r, unicode.L, unicode.N, unicode.P, unicode.S) }

// isForeignKeyViolation reports a write that referred to a row deleted meanwhile.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
