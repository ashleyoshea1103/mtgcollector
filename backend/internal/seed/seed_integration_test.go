//go:build integration

package seed

import (
	"log/slog"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

var quiet = slog.New(slog.DiscardHandler)

// importCards puts a few of the seed's printings in the database, as an import would, so the
// seed finds those and leaves out the rest.
func importCards(t *testing.T, pool *pgxpool.Pool, cs ...card) {
	t.Helper()
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `INSERT INTO sets (code, scryfall_id, name, set_type, released_at)
	                             VALUES ('tst', gen_random_uuid(), 'Test Set', 'core', '2020-01-01')`); err != nil {
		t.Fatal(err)
	}
	for i, c := range cs {
		if _, err := pool.Exec(ctx,
			`INSERT INTO cards (id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
			                    type_line, colors, color_identity, finishes, price_eur, price_eur_foil, released_at)
			 VALUES ($1, gen_random_uuid(), $2, 'en', 'tst', $3, 'common', 'normal', '{R}', 1, 'Instant', '{R}', '{R}',
			         '{nonfoil,foil}', 1.50, 4.00, '2020-01-01')`,
			c.id, c.name, strconv.Itoa(i+1)); err != nil {
			t.Fatal(err)
		}
	}
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSeedNeedsTheCardsImported(t *testing.T) {
	pool := testdb.New(t)
	_, err := Run(t.Context(), pool, quiet)
	if err == nil || !strings.Contains(err.Error(), "go run ./cmd/sync") {
		t.Fatalf("Run with no cards: %v, want an error saying to import them", err)
	}
	if n := count(t, pool, `SELECT count(*) FROM users`); n != 0 {
		t.Errorf("%d accounts made with no cards to seed, want none", n)
	}
}

func TestSeedReplacesItsAccountAndLeavesOutMissingCards(t *testing.T) {
	pool := testdb.New(t)
	importCards(t, pool, bolt, mountain, revisedSerraAngel)
	ctx := t.Context()

	// Twice: the second run must replace the first's data, not add to it.
	for run := 1; run <= 2; run++ {
		res, err := Run(ctx, pool, quiet)
		if err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
		// Bolt has two entries (non-foil and foil); Mountain and the old Serra Angel one each.
		if res.Entries != 4 || res.Groups != len(groups) {
			t.Errorf("run %d: %d entries and %d groups, want 4 and %d", run, res.Entries, res.Groups, len(groups))
		}
		if want := len(entries) - 4; len(res.Missing) != want {
			t.Errorf("run %d: %d cards reported missing, want %d", run, len(res.Missing), want)
		}
	}
	if n := count(t, pool, `SELECT count(*) FROM users`); n != 1 {
		t.Errorf("%d accounts after two runs, want 1", n)
	}
	if n := count(t, pool, `SELECT count(*) FROM collection_entries`); n != 4 {
		t.Errorf("%d entries after two runs, want 4", n)
	}

	// Lightning Bolt's non-foil entry is in the deck and the binder at once.
	in := func(group string) int {
		return count(t, pool, `SELECT coalesce(sum(m.quantity), 0) FROM group_members m
		                         JOIN custom_groups g ON g.id = m.group_id
		                         JOIN collection_entries e ON e.id = m.entry_id
		                        WHERE g.name = $1 AND e.card_id = $2 AND e.finish = 'nonfoil'`, group, bolt.id)
	}
	if deckCopies, binderCopies := in(deck), in(binder); deckCopies != 4 || binderCopies != 2 {
		t.Errorf("Lightning Bolt: %d copies in the deck and %d in the binder, want 4 and 2", deckCopies, binderCopies)
	}
	if n := count(t, pool, `SELECT count(*) FROM custom_groups g WHERE g.name = $1
	                         AND NOT EXISTS (SELECT FROM group_members m WHERE m.group_id = g.id)`, toSort); n != 1 {
		t.Errorf("%q should be there and empty", toSort)
	}

	// The old Serra Angel is no longer listed, its prices cleared.
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE id = $1 AND gone_since IS NOT NULL AND price_eur IS NULL`,
		revisedSerraAngel.id); n != 1 {
		t.Error("the Revised Serra Angel should be marked gone, with no price")
	}

	// The printed email and password log in.
	if _, _, err := auth.NewService(store.New(pool)).Login(ctx, Email, Password); err != nil {
		t.Errorf("logging in as the seed account: %v", err)
	}
}

// The tests' database isn't the development one, so the seed refuses it.
func TestSeedRefusesAnyDatabaseButTheDevelopmentOne(t *testing.T) {
	pool := testdb.New(t)
	err := CheckDatabase(t.Context(), pool)
	if err == nil || !strings.Contains(err.Error(), "refusing to seed") {
		t.Fatalf("CheckDatabase on the test database: %v, want a refusal", err)
	}
}
