//go:build integration

package cards

import (
	"context"
	"errors"
	"io"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// Edge cases of the import: forced re-imports, renamed sets, cards that leave the file,
// files that keep failing, cancellation, and the staging table's shape.

func TestAForcedImportOfTheSameFileWritesNothing(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	var before int
	if err := pool.QueryRow(t.Context(), `SELECT max(xmin::text::bigint) FROM cards`).Scan(&before); err != nil {
		t.Fatal(err)
	}

	res, err := im.Run(t.Context(), true)
	if err != nil {
		t.Fatal(err)
	}
	if res.Unchanged || src.reads != 2 || res.CardsChanged != 0 || res.CardsGone != 0 {
		t.Errorf("forced Run() = %+v after %d reads; want the file read again and nothing written", res, src.reads)
	}
	// Not even rewritten in place: no card row has a newer version than the first import made.
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE xmin::text::bigint > $1`, before); n != 0 {
		t.Errorf("%d unchanged cards were rewritten", n)
	}
}

func TestASetWhoseCodeChangesKeepsItsCards(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}

	// Scryfall renames m10 (same set id) and its card moves with it; another set's name changes.
	for i := range src.sets {
		switch src.sets[i].Code {
		case "m10":
			src.sets[i].Code = "m10x"
		case "mh2":
			src.sets[i].Name = "Modern Horizons 2 (renamed)"
		}
	}
	src.cards[0].Set = "m10x"
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatalf("import after the rename: %v", err)
	}

	if n := count(t, pool, `SELECT count(*) FROM sets WHERE code = 'm10'`); n != 0 {
		t.Error("the old code is still there")
	}
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE set_code = 'm10x'`); n != 1 {
		t.Errorf("%d cards in the renamed set, want 1", n)
	}
	if n := count(t, pool, `SELECT count(*) FROM sets WHERE name = 'Modern Horizons 2 (renamed)'`); n != 1 {
		t.Error("the set's new name wasn't saved")
	}
}

func TestCardsThatLeaveTheFileAreMarkedGone(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	for range 40 { // enough cards that losing one stays under the share an import may lose
		c := rawCard(t, "m19-314")
		c.ID = randomUUID()
		src.cards = append(src.cards, c)
	}
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}

	gone := src.cards[0]
	src.cards = src.cards[1:]
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	res, err := im.Run(t.Context(), false)
	if err != nil {
		t.Fatal(err)
	}
	if res.CardsGone != 1 {
		t.Errorf("CardsGone = %d, want 1", res.CardsGone)
	}
	if n := count(t, pool, `SELECT count(*) FROM cards
		  WHERE id = $1 AND gone_since IS NOT NULL AND price_eur IS NULL AND price_usd IS NULL`, gone.ID); n != 1 {
		t.Error("the card that left wasn't marked gone with its prices cleared")
	}

	// It comes back the next day: it's present again, with its prices.
	src.cards = append(src.cards, gone)
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if n := count(t, pool, `SELECT count(*) FROM cards
		  WHERE id = $1 AND gone_since IS NULL AND price_eur IS NOT NULL`, gone.ID); n != 1 {
		t.Error("the card that came back isn't present with its price")
	}
}

func TestAFileMissingManyCardsIsRefused(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	src.cards = src.cards[:3] // half the cards missing: an incomplete file, not real deletions
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	if _, err := im.Run(t.Context(), false); err == nil {
		t.Fatal("Run() accepted a file missing half the cards")
	}
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE gone_since IS NOT NULL`); n != 0 {
		t.Errorf("%d cards marked gone by a refused import", n)
	}
}

func TestAFileThatKeepsFailingIsLeftUntilTheNextOne(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	src.failAfter = 2
	im := newImporter(pool, src)
	for range maxAttemptsPerFile {
		if _, err := im.Run(t.Context(), false); !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("Run() = %v, want the download error", err)
		}
	}
	if _, err := im.Run(t.Context(), false); !errors.Is(err, ErrGaveUp) || src.reads != maxAttemptsPerFile {
		t.Errorf("Run() = %v after %d reads; want ErrGaveUp without downloading again", err, src.reads)
	}

	// Forcing still tries.
	src.failAfter = 0
	if _, err := im.Run(t.Context(), true); err != nil {
		t.Errorf("forced Run() = %v", err)
	}
}

func TestACancelledImportIsRecordedAndKeepsNoLock(t *testing.T) {
	pool := testdb.New(t)
	im := newImporter(pool, newSource(t))

	// Another session holds the cards table, so the import's merge waits; then it's cancelled.
	blocker, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	if _, err := blocker.Exec(t.Context(), `LOCK TABLE cards IN EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
	defer cancel()
	if _, err := im.Run(ctx, false); err == nil {
		t.Fatal("Run() succeeded while the table was locked")
	}

	if n := count(t, pool, `SELECT count(*) FROM scryfall_syncs WHERE finished_at IS NOT NULL AND error IS NOT NULL`); n != 1 {
		t.Error("the cancelled import wasn't recorded as failed")
	}
	// The waiting query was cancelled on the server, not just abandoned, so its session let go
	// of the import lock even though the table is still locked.
	var free bool
	if err := pool.QueryRow(t.Context(), `SELECT pg_try_advisory_lock($1)`, im.LockKey).Scan(&free); err != nil {
		t.Fatal(err)
	}
	if !free {
		t.Error("the cancelled import's session still holds the import lock")
	} else if _, err := pool.Exec(t.Context(), `SELECT pg_advisory_unlock_all()`); err != nil {
		t.Fatal(err)
	}
	// And once the table is free, the next import runs.
	if err := blocker.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Errorf("Run() after the cancelled one: %v", err)
	}
}

// cards_staging was copied from cards when it was created: a later migration that adds a
// column to one must add it to the other.
func TestStagingHasTheSameColumnsAsCards(t *testing.T) {
	pool := testdb.New(t)
	columns := func(table string) []string {
		rows, err := pool.Query(t.Context(),
			`SELECT column_name || ' ' || data_type FROM information_schema.columns
			  WHERE table_schema = current_schema() AND table_name = $1 ORDER BY column_name`, table)
		if err != nil {
			t.Fatal(err)
		}
		cols, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		return cols
	}
	if cards, staging := columns("cards"), columns("cards_staging"); !slices.Equal(cards, staging) {
		t.Errorf("cards:   %v\nstaging: %v", cards, staging)
	}
}

// The merge and the gone-card checks look staged cards up by id. Without an index that's a
// comparison of every card with every other: hours on Scryfall's ~110,000 cards, where the
// tests' handful of cards would never notice.
func TestStagedCardsAreIndexedByID(t *testing.T) {
	pool := testdb.New(t)
	if n := count(t, pool, `SELECT count(*) FROM pg_indexes
		  WHERE schemaname = current_schema() AND tablename = 'cards_staging' AND indexdef LIKE '%(id)'`); n != 1 {
		t.Error("cards_staging has no index on id")
	}
}
