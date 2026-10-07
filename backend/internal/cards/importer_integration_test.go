//go:build integration

package cards

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math/rand/v2"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// fakeSource serves Scryfall data from memory.
type fakeSource struct {
	updatedAt time.Time
	sets      []scryfall.Set
	cards     []scryfall.Card
	failAfter int // if > 0, EachCard fails after this many cards, like a dropped download
	badLines  int // lines EachCard reports as undecodable, after the cards
	reads     int // how many times the bulk file was read
}

func (f *fakeSource) DefaultCards(context.Context) (scryfall.BulkFile, error) {
	return scryfall.BulkFile{DownloadURI: "https://data.scryfall.io/x.jsonl.gz", UpdatedAt: f.updatedAt}, nil
}

func (f *fakeSource) Sets(context.Context) ([]scryfall.Set, error) { return f.sets, nil }

func (f *fakeSource) EachCard(_ context.Context, _ scryfall.BulkFile, fn func(scryfall.Card) error, bad func(int, error)) error {
	f.reads++
	for i, c := range f.cards {
		if f.failAfter > 0 && i == f.failAfter {
			return io.ErrUnexpectedEOF
		}
		if err := fn(c); err != nil {
			return err
		}
	}
	for i := range f.badLines {
		bad(len(f.cards)+i+1, errors.New("json: cannot unmarshal string into Go struct field"))
	}
	return nil
}

// newSource has the six fixture printings and their sets.
func newSource(t *testing.T) *fakeSource {
	t.Helper()
	src := &fakeSource{updatedAt: time.Date(2026, 10, 7, 9, 5, 47, 0, time.UTC)}
	seen := map[string]bool{}
	for _, file := range []string{"m10-146", "mh2-138", "isd-51", "mh2-290", "sld-381", "m19-314"} {
		c := rawCard(t, file)
		src.cards = append(src.cards, c)
		if !seen[c.Set] {
			seen[c.Set] = true
			src.sets = append(src.sets, scryfall.Set{
				ID: randomUUID(), Code: c.Set, Name: c.Set + " set", SetType: "expansion",
				ReleasedAt: c.ReleasedAt, IconSVGURI: "https://svgs.scryfall.io/sets/" + c.Set + ".svg",
			})
		}
	}
	return src
}

func randomUUID() string {
	const hex = "0123456789abcdef"
	b := []byte("xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx")
	for i, ch := range b {
		if ch == 'x' {
			b[i] = hex[rand.IntN(16)]
		}
	}
	return string(b)
}

func newImporter(pool *pgxpool.Pool, src Source) *Importer {
	return &Importer{
		Pool: pool, Source: src,
		LockKey: rand.Int64(), // this test's own lock, so parallel tests don't wait on each other
		Log:     slog.New(slog.DiscardHandler),
	}
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(t.Context(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func TestFirstImportLoadsSetsAndCards(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	digital := rawCard(t, "m10-146")
	digital.ID, digital.Digital = randomUUID(), true
	unknownSet := rawCard(t, "m10-146")
	unknownSet.ID, unknownSet.Set = randomUUID(), "zzz"
	broken := rawCard(t, "m10-146")
	broken.ID, broken.Rarity = randomUUID(), "legendary"
	src.cards = append(src.cards, digital, unknownSet, broken)
	// Enough good cards that the two bad ones stay under the share an import may skip.
	for range 40 {
		c := rawCard(t, "m19-314")
		c.ID = randomUUID()
		src.cards = append(src.cards, c)
	}

	res, err := newImporter(pool, src).Run(t.Context(), false)
	if err != nil {
		t.Fatal(err)
	}

	want := Result{BulkUpdatedAt: src.updatedAt, SetsSeen: 5, CardsSeen: 48, CardsSkipped: 2, CardsChanged: 46}
	if res != want {
		t.Errorf("Run() = %+v\nwant     %+v", res, want)
	}
	if n := count(t, pool, `SELECT count(*) FROM cards`); n != 46 {
		t.Errorf("%d cards, want 46 (digital, unknown-set and broken ones left out)", n)
	}
	if n := count(t, pool, `SELECT count(*) FROM sets`); n != 5 {
		t.Errorf("%d sets, want 5", n)
	}
	if n := count(t, pool, `SELECT count(*) FROM cards_staging`); n != 0 {
		t.Errorf("%d rows left in cards_staging", n)
	}
	// What the importer recorded about itself.
	var seen, skipped, changed int
	var errText *string
	if err := pool.QueryRow(t.Context(),
		`SELECT cards_seen, cards_skipped, cards_changed, error FROM scryfall_syncs WHERE finished_at IS NOT NULL`,
	).Scan(&seen, &skipped, &changed, &errText); err != nil {
		t.Fatal(err)
	}
	if seen != 48 || skipped != 2 || changed != 46 || errText != nil {
		t.Errorf("scryfall_syncs row: seen %d, skipped %d, changed %d, error %v", seen, skipped, changed, errText)
	}
	// A spot check that the mapped values reached the table intact.
	var name string
	var eurFoil *float64
	var finishes []string
	if err := pool.QueryRow(t.Context(),
		`SELECT name, price_eur_foil::float8, finishes FROM cards WHERE set_code = 'sld' AND collector_number = '381'`,
	).Scan(&name, &eurFoil, &finishes); err != nil {
		t.Fatal(err)
	}
	if name != "Propaganda" || eurFoil == nil || !slices.Equal(finishes, []string{"foil"}) {
		t.Errorf("Propaganda row: %q, eur_foil %v, finishes %v", name, eurFoil, finishes)
	}
}

func TestAnUnchangedBulkFileIsntReadAgain(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}

	res, err := im.Run(t.Context(), false)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Unchanged || src.reads != 1 {
		t.Errorf("second Run() = %+v after %d reads, want unchanged without reading again", res, src.reads)
	}
	// It still counts as a successful import for the daily schedule.
	if n := count(t, pool, `SELECT count(*) FROM scryfall_syncs WHERE finished_at IS NOT NULL AND error IS NULL`); n != 2 {
		t.Errorf("%d successful imports recorded, want 2", n)
	}
}

func TestOnlyChangedCardsAreRewritten(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	updatedAt := func() map[string]time.Time {
		rows, err := pool.Query(t.Context(), `SELECT id::text, updated_at FROM cards`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		m := map[string]time.Time{}
		for rows.Next() {
			var id string
			var at time.Time
			if err := rows.Scan(&id, &at); err != nil {
				t.Fatal(err)
			}
			m[id] = at
		}
		return m
	}
	before := updatedAt()

	// The next day's file: one price moved, nothing else did.
	price := "99.99"
	src.cards[0].Prices.EUR = &price
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	res, err := im.Run(t.Context(), false)
	if err != nil {
		t.Fatal(err)
	}

	if res.CardsChanged != 1 {
		t.Errorf("CardsChanged = %d, want 1", res.CardsChanged)
	}
	after := updatedAt()
	for id, at := range after {
		if moved := !at.Equal(before[id]); moved != (id == src.cards[0].ID) {
			t.Errorf("card %s: updated_at moved = %v", id, moved)
		}
	}
	var eur float64
	if err := pool.QueryRow(t.Context(), `SELECT price_eur::float8 FROM cards WHERE id = $1`, src.cards[0].ID).Scan(&eur); err != nil {
		t.Fatal(err)
	}
	if eur != 99.99 {
		t.Errorf("price_eur = %v, want 99.99", eur)
	}
}

func TestAFailedImportChangesNothing(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}

	// The next file is cut off part way, after a price change and a new set.
	price := "99.99"
	src.cards[0].Prices.EUR = &price
	src.sets = append(src.sets, scryfall.Set{ID: randomUUID(), Code: "new", Name: "New", SetType: "expansion"})
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	src.failAfter = 3
	_, err := im.Run(t.Context(), false)

	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("Run() error = %v, want the download's error", err)
	}
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE price_eur = 99.99`); n != 0 {
		t.Error("a card from the failed import was saved")
	}
	if n := count(t, pool, `SELECT count(*) FROM sets WHERE code = 'new'`); n != 0 {
		t.Error("a set from the failed import was saved")
	}
	if n := count(t, pool, `SELECT count(*) FROM scryfall_syncs WHERE error LIKE '%unexpected EOF%'`); n != 1 {
		t.Error("the failure wasn't recorded in scryfall_syncs")
	}
	// The failed import doesn't count, so the next one reads the file again.
	src.failAfter = 0
	res, err := im.Run(t.Context(), false)
	if err != nil || res.Unchanged || res.CardsChanged != 1 {
		t.Errorf("retry: Run() = %+v, %v; want the file imported, 1 card changed", res, err)
	}
}

func TestImportsDontOverlap(t *testing.T) {
	pool := testdb.New(t)
	im := newImporter(pool, newSource(t))

	// Another process is importing: it holds the lock.
	other, err := pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Release()
	if _, err := other.Exec(t.Context(), `SELECT pg_advisory_lock($1)`, im.LockKey); err != nil {
		t.Fatal(err)
	}

	if _, err := im.Run(t.Context(), false); !errors.Is(err, ErrAlreadyRunning) {
		t.Errorf("Run() error = %v, want ErrAlreadyRunning", err)
	}

	if _, err := other.Exec(t.Context(), `SELECT pg_advisory_unlock($1)`, im.LockKey); err != nil {
		t.Fatal(err)
	}
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Errorf("Run() after the other import finished: %v", err)
	}
	// And Run gave its own lock back.
	var free bool
	if err := other.QueryRow(t.Context(), `SELECT pg_try_advisory_lock($1)`, im.LockKey).Scan(&free); err != nil || !free {
		t.Errorf("the lock is still held after Run returned (%v)", err)
	}
}

func TestDue(t *testing.T) {
	pool := testdb.New(t)
	im := newImporter(pool, newSource(t))

	if due, err := im.Due(t.Context(), 24*time.Hour); err != nil || !due {
		t.Errorf("Due() before any import = %v, %v; want true", due, err)
	}
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}
	if due, err := im.Due(t.Context(), 24*time.Hour); err != nil || due {
		t.Errorf("Due() straight after an import = %v, %v; want false", due, err)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE scryfall_syncs SET finished_at = now() - interval '25 hours'`); err != nil {
		t.Fatal(err)
	}
	if due, err := im.Due(t.Context(), 24*time.Hour); err != nil || !due {
		t.Errorf("Due() a day later = %v, %v; want true", due, err)
	}
}

func TestTooManySkippedCardsAbortTheImport(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	if _, err := im.Run(t.Context(), false); err != nil {
		t.Fatal(err)
	}

	// The next file's format changed: most of its lines no longer decode.
	price := "99.99"
	src.cards[0].Prices.EUR = &price
	src.badLines = 20
	src.updatedAt = src.updatedAt.Add(24 * time.Hour)
	_, err := im.Run(t.Context(), false)

	if err == nil {
		t.Fatal("Run() imported a file where most cards couldn't be read")
	}
	if n := count(t, pool, `SELECT count(*) FROM cards WHERE price_eur = 99.99`); n != 0 {
		t.Error("cards from the refused import were saved")
	}
}

func TestRunDailyImportsWhenDueAndStopsOnCancel(t *testing.T) {
	pool := testdb.New(t)
	src := newSource(t)
	im := newImporter(pool, src)
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		im.RunDaily(ctx, 50*time.Millisecond)
		close(done)
	}()

	// It imports straight away (there's never been an import), then only checks: the next
	// import isn't due for a day.
	deadline := time.Now().Add(10 * time.Second)
	for count(t, pool, `SELECT count(*) FROM scryfall_syncs WHERE finished_at IS NOT NULL`) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("RunDaily didn't import")
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(300 * time.Millisecond) // several more checks
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunDaily didn't stop when cancelled")
	}
	if n := count(t, pool, `SELECT count(*) FROM scryfall_syncs`); n != 1 || src.reads != 1 {
		t.Errorf("%d imports recorded, %d bulk reads; want 1 each (later checks found nothing due)", n, src.reads)
	}
}
