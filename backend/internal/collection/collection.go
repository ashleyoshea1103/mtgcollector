// Package collection is the cards each user owns: adding, changing and removing entries,
// and reading them grouped (by set, colour, type, rarity or mana value), sorted and paged,
// with their EUR values.
package collection

import (
	"context"
	"encoding"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// PageSize is how many entries a page holds.
const PageSize = 60

// How long one call may wait for the database.
const queryTimeout = 5 * time.Second

var (
	ErrNotFound = apperr.New(apperr.NotFound, "no such entry")
	// A change that would make an entry the same as another of the user's.
	ErrConflict = apperr.New(apperr.Conflict, "you already have this card with those details; change that entry instead")
)

// invalid is a request the server won't accept; the message says why, for the user.
func invalid(format string, args ...any) error {
	return apperr.New(apperr.Invalid, format, args...)
}

// Service does the work, for one user at a time: every call takes the user's id, and every
// query is limited to that user's entries.
type Service struct {
	Pool *pgxpool.Pool
	// The most entries a collection can hold; zero means contract.MaxEntries.
	MaxEntries int
	// The most custom groups a user can have; zero means contract.MaxGroups.
	MaxGroups int
	// The most group members a user can have; zero means contract.MaxMembers.
	MaxMembers int
}

func (s *Service) q() *store.Queries { return store.New(s.Pool) }

func (s *Service) maxEntries() int {
	if s.MaxEntries > 0 {
		return s.MaxEntries
	}
	return contract.MaxEntries
}

// Add adds copies of a printing: a new entry, or more copies of the one the user has with
// the same finish, condition and language. It says whether the entry is new.
func (s *Service) Add(ctx context.Context, userID int64, e contract.NewEntry) (contract.CollectionEntry, bool, error) {
	cardID, err := cards.ParseID(e.CardID)
	if err != nil {
		return contract.CollectionEntry{}, false, invalid("card_id must be a Scryfall id, like 0b8fe8b3-…")
	}
	if err := checkEntry(e.Quantity, e.Finish, e.Condition, e.Language); err != nil {
		return contract.CollectionEntry{}, false, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	var row store.AddEntryRow
	add := func(q *store.Queries) (err error) {
		row, err = q.AddEntry(ctx, store.AddEntryParams{
			UserID: userID, CardID: cardID, Quantity: int32(e.Quantity),
			Finish: string(e.Finish), Condition: string(e.Condition), Language: string(e.Language),
			MaxEntries: int32(s.maxEntries()), MaxQuantity: contract.MaxQuantity,
		})
		return err
	}
	if e.GroupID == nil {
		err = add(s.q())
	} else {
		// The copies go in the group too: both or neither.
		err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
			q := store.New(tx)
			if err := add(q); err != nil {
				return err
			}
			n, err := q.AddToGroup(ctx, store.AddToGroupParams{
				UserID: userID, GroupID: *e.GroupID, EntryID: row.ID, Quantity: int32(e.Quantity), MaxMembers: int32(s.maxMembers()),
			})
			if err == nil && n == 0 {
				err = s.whyNotGrouped(ctx, q, userID, *e.GroupID)
			}
			return err
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, false, s.whyNotAdded(ctx, userID, cardID, e)
	}
	if e.GroupID != nil && isForeignKeyViolation(err) { // the group was deleted just as the copies went in
		return contract.CollectionEntry{}, false, s.whyNotGrouped(ctx, s.q(), userID, *e.GroupID)
	}
	if err != nil {
		return contract.CollectionEntry{}, false, dbError(ctx, "add entry", err)
	}
	entry, err := s.get(ctx, userID, row.ID)
	return entry, row.Created, err
}

// dbError is db.Error for an error that may be a caller's mistake instead, which is returned as it is.
func dbError(ctx context.Context, what string, err error) error {
	if apperr.KindOf(err) != 0 {
		return err
	}
	return db.Error(ctx, what, err)
}

// whyNotAdded says why AddEntry added nothing: there's no such card, it doesn't come in
// that finish, there would be too many copies, or too many entries.
func (s *Service) whyNotAdded(ctx context.Context, userID int64, cardID pgtype.UUID, e contract.NewEntry) error {
	finishes, err := s.q().CardFinishes(ctx, cardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalid("there's no card with that id")
	}
	if err != nil {
		return db.Error(ctx, "find card", err)
	}
	if err := checkFinish(e.Finish, finishes); err != nil {
		return err
	}
	has, err := s.q().HasEntry(ctx, store.HasEntryParams{
		UserID: userID, CardID: cardID, Finish: string(e.Finish), Condition: string(e.Condition), Language: string(e.Language),
	})
	if err != nil {
		return db.Error(ctx, "find entry", err)
	}
	if has {
		return invalid("that would make more than %d copies of this card", contract.MaxQuantity)
	}
	return invalid("your collection has %d entries, the most it can hold; remove some to add others", s.maxEntries())
}

// Change changes an entry's quantity, finish, condition or language: only those given, so two
// changes at once don't undo each other.
func (s *Service) Change(ctx context.Context, userID, id int64, c contract.EntryChange) (contract.CollectionEntry, error) {
	if c == (contract.EntryChange{}) {
		return contract.CollectionEntry{}, invalid("give at least one of quantity, finish, condition and language to change")
	}
	next := store.UpdateEntryParams{UserID: userID, ID: id}
	if c.Quantity != nil {
		if *c.Quantity < 1 || *c.Quantity > contract.MaxQuantity {
			return contract.CollectionEntry{}, invalid("quantity must be from 1 to %d", contract.MaxQuantity)
		}
		next.Quantity = pgtype.Int4{Int32: int32(*c.Quantity), Valid: true}
	}
	var err error
	if c.Finish != nil {
		next.Finish, err = enumParam(*c.Finish)
	}
	if err == nil && c.Condition != nil {
		next.Condition, err = enumParam(*c.Condition)
	}
	if err == nil && c.Language != nil {
		next.Language, err = enumParam(*c.Language)
	}
	if err != nil {
		return contract.CollectionEntry{}, invalid("%s", err)
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	_, err = s.q().UpdateEntry(ctx, next)
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return contract.CollectionEntry{}, s.whyNotChanged(ctx, userID, id, c)
	case errors.As(err, &pgErr) && pgErr.Code == "23505": // unique_violation
		return contract.CollectionEntry{}, ErrConflict
	case err != nil:
		return contract.CollectionEntry{}, db.Error(ctx, "change entry", err)
	}
	return s.get(ctx, userID, id)
}

// whyNotChanged says why UpdateEntry changed nothing: there's no such entry, or its card
// doesn't come in the finish asked for.
func (s *Service) whyNotChanged(ctx context.Context, userID, id int64, c contract.EntryChange) error {
	cur, err := s.q().EntryCard(ctx, store.EntryCardParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return db.Error(ctx, "find entry", err)
	}
	if c.Finish != nil {
		if err := checkFinish(*c.Finish, cur.Finishes); err != nil {
			return err
		}
	}
	return ErrNotFound // deleted and remade meanwhile, say: try again
}

// enumParam is an enum's value as a query parameter, if it's one of the enum's values.
func enumParam[T ~string, P interface {
	*T
	encoding.TextUnmarshaler
}](v T) (pgtype.Text, error) {
	if err := checkEnum[T, P](v); err != nil {
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: string(v), Valid: true}, nil
}

// Delete removes an entry.
func (s *Service) Delete(ctx context.Context, userID, id int64) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.q().DeleteEntry(ctx, store.DeleteEntryParams{UserID: userID, ID: id})
	if err != nil {
		return db.Error(ctx, "delete entry", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) get(ctx context.Context, userID, id int64) (contract.CollectionEntry, error) {
	row, err := s.q().GetEntry(ctx, store.GetEntryParams{GroupID: collectionGroup, UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, ErrNotFound
	}
	if err != nil {
		return contract.CollectionEntry{}, db.Error(ctx, "get entry", err)
	}
	return toEntry(row.ListingRow, row.CardListing)
}

// checkEntry checks what an entry is: values the JSON decoder hasn't already checked
// (a missing field is its type's zero value, never a valid one).
func checkEntry(quantity int, finish contract.Finish, condition contract.Condition, language contract.Language) error {
	if quantity < 1 || quantity > contract.MaxQuantity {
		return invalid("quantity must be from 1 to %d", contract.MaxQuantity)
	}
	for _, err := range []error{checkEnum(finish), checkEnum(condition), checkEnum(language)} {
		if err != nil {
			return invalid("%s", err)
		}
	}
	return nil
}

// checkEnum says whether v is one of its type's values (contract/enums.go).
func checkEnum[T ~string, P interface {
	*T
	encoding.TextUnmarshaler
}](v T) error {
	var dst T
	return P(&dst).UnmarshalText([]byte(v))
}

// checkFinish says whether a printing comes in a finish.
func checkFinish(f contract.Finish, finishes []string) error {
	if !slices.Contains(finishes, string(f)) {
		return invalid("this printing doesn't come in %s; it comes in %s", f, strings.Join(finishes, ", "))
	}
	return nil
}

// toEntry is an entry and its card as the API shows them.
func toEntry(r store.ListingRow, v store.CardListing) (contract.CollectionEntry, error) {
	card, err := cards.Summary(v)
	if err != nil {
		return contract.CollectionEntry{}, err
	}
	return contract.CollectionEntry{
		ID: r.ID, Card: card, Quantity: int(r.Quantity),
		Finish: contract.Finish(r.Finish), Condition: contract.Condition(r.Condition), Language: contract.Language(r.Language),
		// To the microsecond, as stored: the newest-first order uses all of it.
		AddedAt:      r.AddedAt.Time.UTC().Format(time.RFC3339Nano),
		UnitPriceEUR: cards.Number(r.UnitPrice),
		ValueEUR:     cards.Number(r.Value),
	}, nil
}
