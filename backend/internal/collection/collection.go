// Package collection is the cards each user owns: adding, changing and removing entries,
// and reading them grouped (by set, colour, type, rarity or mana value), sorted and paged,
// with their EUR values.
package collection

import (
	"context"
	"encoding"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

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
	ErrNotFound = errors.New("no such entry")
	// A change that would make an entry the same as another of the user's.
	ErrConflict = errors.New("you already have this card with those details; change that entry instead")
)

// InputError is a request the server won't accept; Reason says why, for the user.
type InputError struct{ Reason string }

func (e *InputError) Error() string { return e.Reason }

func invalid(format string, args ...any) error {
	return &InputError{fmt.Sprintf(format, args...)}
}

// Service does the work, for one user at a time: every call takes the user's id, and every
// query is limited to that user's entries.
type Service struct {
	Q *store.Queries
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
	if e.GroupID != nil {
		// Custom groups come in a later change; until then, no id is one of the user's.
		return contract.CollectionEntry{}, false, invalid("there's no group with that id")
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	finishes, err := s.Q.CardFinishes(ctx, cardID)
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, false, invalid("there's no card with that id")
	}
	if err != nil {
		return contract.CollectionEntry{}, false, db.Error(ctx, "find card", err)
	}
	if err := checkFinish(e.Finish, finishes); err != nil {
		return contract.CollectionEntry{}, false, err
	}
	row, err := s.Q.AddEntry(ctx, store.AddEntryParams{
		UserID: userID, CardID: cardID, Quantity: int32(e.Quantity),
		Finish: string(e.Finish), Condition: string(e.Condition), Language: string(e.Language),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, false, invalid("that would make more than %d copies of this card", contract.MaxQuantity)
	}
	if err != nil {
		return contract.CollectionEntry{}, false, db.Error(ctx, "add entry", err)
	}
	entry, err := s.get(ctx, userID, row.ID)
	return entry, row.Created, err
}

// Change changes an entry's quantity, finish, condition or language.
func (s *Service) Change(ctx context.Context, userID, id int64, c contract.EntryChange) (contract.CollectionEntry, error) {
	if c == (contract.EntryChange{}) {
		return contract.CollectionEntry{}, invalid("give at least one of quantity, finish, condition and language to change")
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	cur, err := s.Q.EntryCard(ctx, store.EntryCardParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, ErrNotFound
	}
	if err != nil {
		return contract.CollectionEntry{}, db.Error(ctx, "find entry", err)
	}
	next := store.UpdateEntryParams{
		UserID: userID, ID: id, Quantity: cur.Quantity, Finish: cur.Finish, Condition: cur.Condition, Language: cur.Language,
	}
	if c.Quantity != nil {
		if *c.Quantity < 1 || *c.Quantity > contract.MaxQuantity {
			return contract.CollectionEntry{}, invalid("quantity must be from 1 to %d", contract.MaxQuantity)
		}
		next.Quantity = int32(*c.Quantity)
	}
	if c.Finish != nil {
		next.Finish = string(*c.Finish)
	}
	if c.Condition != nil {
		next.Condition = string(*c.Condition)
	}
	if c.Language != nil {
		next.Language = string(*c.Language)
	}
	if err := checkEntry(int(next.Quantity), contract.Finish(next.Finish), contract.Condition(next.Condition), contract.Language(next.Language)); err != nil {
		return contract.CollectionEntry{}, err
	}
	if c.Finish != nil {
		if err := checkFinish(*c.Finish, cur.Finishes); err != nil {
			return contract.CollectionEntry{}, err
		}
	}
	_, err = s.Q.UpdateEntry(ctx, next)
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return contract.CollectionEntry{}, ErrNotFound // deleted meanwhile
	case errors.As(err, &pgErr) && pgErr.Code == "23505": // unique_violation
		return contract.CollectionEntry{}, ErrConflict
	case err != nil:
		return contract.CollectionEntry{}, db.Error(ctx, "change entry", err)
	}
	return s.get(ctx, userID, id)
}

// Delete removes an entry.
func (s *Service) Delete(ctx context.Context, userID, id int64) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	n, err := s.Q.DeleteEntry(ctx, store.DeleteEntryParams{UserID: userID, ID: id})
	if err != nil {
		return db.Error(ctx, "delete entry", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) get(ctx context.Context, userID, id int64) (contract.CollectionEntry, error) {
	row, err := s.Q.GetEntry(ctx, store.GetEntryParams{UserID: userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CollectionEntry{}, ErrNotFound
	}
	if err != nil {
		return contract.CollectionEntry{}, db.Error(ctx, "get entry", err)
	}
	return toEntry(store.EntriesByNameRow(row))
}

// checkEntry checks what an entry is: values the JSON decoder hasn't already checked
// (a missing field is its type's zero value, never a valid one).
func checkEntry(quantity int, finish contract.Finish, condition contract.Condition, language contract.Language) error {
	if quantity < 1 || quantity > contract.MaxQuantity {
		return invalid("quantity must be from 1 to %d", contract.MaxQuantity)
	}
	for _, err := range []error{checkEnum(finish), checkEnum(condition), checkEnum(language)} {
		if err != nil {
			return &InputError{err.Error()}
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

// toEntry is an entry row as the API shows it. Every entry query returns the same columns.
func toEntry(r store.EntriesByNameRow) (contract.CollectionEntry, error) {
	card, err := cards.Summary(r.CardListing)
	if err != nil {
		return contract.CollectionEntry{}, err
	}
	return contract.CollectionEntry{
		ID: r.ID, Card: card, Quantity: int(r.Quantity),
		Finish: contract.Finish(r.Finish), Condition: contract.Condition(r.Condition), Language: contract.Language(r.Language),
		AddedAt:      r.AddedAt.Time.UTC().Format(time.RFC3339),
		UnitPriceEUR: cards.Number(r.UnitPrice),
		ValueEUR:     cards.Number(r.Value),
	}, nil
}
