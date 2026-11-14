// Package seed fills the development database with an account and a collection worth
// looking at: cards of every colour, rarity, mana value and type, in every finish and several
// conditions and languages, and custom groups. It works through the same services as the
// API, so the data keeps to every rule the API enforces. cmd/seed runs it.
package seed

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// The account the seed makes. example.com is reserved, so it's no one's real address.
const (
	Email    = "dev@example.com"
	Password = "correct horse battery staple"
)

// DevDatabase is the only database the seed fills: the development one that
// scripts/setup-dev-db.sh creates.
const DevDatabase = "mtgcollector"

// CheckDatabase refuses any database but the development one, so the seed can never replace
// an account, or mark a card gone, where the data is real.
func CheckDatabase(ctx context.Context, pool *pgxpool.Pool) error {
	var name string
	if err := pool.QueryRow(ctx, "SELECT current_database()").Scan(&name); err != nil {
		return fmt.Errorf("read the database's name: %w", err)
	}
	if name != DevDatabase {
		return fmt.Errorf("refusing to seed database %q: the seed only fills the development database, %q", name, DevDatabase)
	}
	return nil
}

// Result is what a run did.
type Result struct {
	Entries int      // collection entries added
	Groups  int      // custom groups made
	Missing []string // cards the seed names that the database doesn't have
}

// Run replaces the seed account and its data with a fresh copy. The cards must be imported
// already (go run ./cmd/sync); a card the seed names that isn't there is left out and listed
// in the result.
func Run(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) (Result, error) {
	q := store.New(pool)
	var imported bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT FROM cards)").Scan(&imported); err != nil {
		return Result{}, fmt.Errorf("check for cards: %w", err)
	}
	if !imported {
		return Result{}, errors.New("no cards in the database; import them first with go run ./cmd/sync")
	}

	// Everything the account owns goes with it (the foreign keys cascade), so a second run
	// starts from nothing rather than adding to the first.
	if _, err := q.DeleteUserByEmail(ctx, Email); err != nil {
		return Result{}, fmt.Errorf("remove the old seed account: %w", err)
	}
	user, _, err := auth.NewService(q).Signup(ctx, Email, Password)
	if err != nil {
		return Result{}, fmt.Errorf("create the seed account: %w", err)
	}

	owned := &collection.Service{Pool: pool}
	var res Result
	groupIDs := map[string]int64{}
	for _, g := range groups {
		made, err := owned.CreateGroup(ctx, user.ID, g)
		if err != nil {
			return res, fmt.Errorf("make group %q: %w", g.Name, err)
		}
		groupIDs[g.Name] = made.ID
		res.Groups++
	}

	for _, e := range entries {
		id, err := cards.ParseID(e.card.id)
		if err != nil {
			return res, fmt.Errorf("%s: %w", e.card, err)
		}
		if _, err := q.CardFinishes(ctx, id); errors.Is(err, pgx.ErrNoRows) {
			res.Missing = append(res.Missing, e.card.String())
			continue
		} else if err != nil {
			return res, fmt.Errorf("find %s: %w", e.card, err)
		}
		added, _, err := owned.Add(ctx, user.ID, contract.NewEntry{
			CardID: e.card.id, Quantity: e.quantity, Finish: e.finish, Condition: e.condition, Language: e.language,
		})
		if err != nil {
			// The card is there, so this is a mistake in the seed's own list (a finish the
			// printing doesn't come in, say): stop, so it gets fixed.
			return res, fmt.Errorf("add %s: %w", e.card, err)
		}
		res.Entries++
		// As it happens for real: a printing you own that Scryfall later stops listing.
		if e.gone {
			if _, err := q.MarkCardGone(ctx, id); err != nil {
				return res, fmt.Errorf("mark %s no longer listed: %w", e.card, err)
			}
		}
		for group, copies := range e.in {
			if _, _, err := owned.SetMember(ctx, user.ID, groupIDs[group], added.ID, copies); err != nil {
				return res, fmt.Errorf("put %s in %q: %w", e.card, group, err)
			}
		}
	}
	for _, m := range res.Missing {
		log.Warn("card not in the database, left out (removed by Scryfall, or not imported yet?)", "card", m)
	}
	return res, nil
}
