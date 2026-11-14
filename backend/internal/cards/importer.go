// Package cards keeps the local copy of Scryfall's card data: it imports the daily bulk
// file into the sets and cards tables.
package cards

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// Source is where an import reads Scryfall's data. *scryfall.Client is the real one.
type Source interface {
	DefaultCards(ctx context.Context) (scryfall.BulkFile, error)
	Sets(ctx context.Context) ([]scryfall.Set, error)
	EachCard(ctx context.Context, f scryfall.BulkFile, fn func(scryfall.Card) error, bad func(line int, err error)) error
}

// DefaultLockKey is the Postgres advisory lock that keeps imports from overlapping.
const DefaultLockKey int64 = 0x6d74_6763_7379_6e63 // "mtgcsync"

var (
	// ErrAlreadyRunning means another import (in this or another process) holds the lock.
	ErrAlreadyRunning = errors.New("a Scryfall import is already running")
	// ErrGaveUp means imports of the current bulk file have failed too often to try again;
	// the next file Scryfall publishes is imported as usual.
	ErrGaveUp = errors.New("imports of this Scryfall bulk file keep failing")
)

const (
	batchSize = 1000 // cards sent to Postgres at a time
	// Skipped cards logged one by one; the rest are only counted.
	loggedSkips = 20
	// An import that would skip, or mark gone, more than this share of the cards is refused,
	// keeping the previous data: that many means Scryfall's format changed, or the file is
	// incomplete, not that a few cards are odd.
	maxSkippedShare = 0.05
	// Far more cards than Scryfall has (about 110,000), so a runaway file can't fill the disk.
	maxCards = 1_000_000
	// How many times one bulk file may fail to import before waiting for the next one,
	// rather than downloading it again every hour.
	maxAttemptsPerFile = 3
)

// Importer imports Scryfall's bulk data. Its fields must be set before use.
type Importer struct {
	Pool   *pgxpool.Pool
	Source Source
	// LockKey is the advisory lock imports take: DefaultLockKey, or a test's own key so
	// parallel tests don't wait on each other.
	LockKey int64
	Log     *slog.Logger
}

// Result describes one import.
type Result struct {
	Unchanged     bool // the bulk file hadn't changed since the last import, so nothing was read
	BulkUpdatedAt time.Time
	SetsSeen      int
	CardsSeen     int // paper printings in the bulk file (digital-only ones are ignored)
	CardsSkipped  int // of those, ones that couldn't be imported (each reason is logged)
	CardsChanged  int // inserted, or updated because something about them changed
	CardsGone     int // no longer in the file: marked gone, their prices cleared
}

// Run imports the current bulk file, unless it's the one the last successful import read
// (force imports it anyway). The cards are downloaded into a staging table first, then
// sets and cards are updated in one short transaction, so a failed import leaves the
// previous data as it was. Every import that reads a file is recorded in scryfall_syncs.
func (im *Importer) Run(ctx context.Context, force bool) (Result, error) {
	conn, err := im.Pool.Acquire(ctx)
	if err != nil {
		return Result{}, err
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", im.LockKey).Scan(&locked); err != nil {
		return Result{}, err
	}
	if !locked {
		return Result{}, ErrAlreadyRunning
	}
	defer func() {
		// The lock belongs to this connection's session: never hand it back to the pool still
		// holding it.
		if _, err := conn.Exec(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", im.LockKey); err != nil {
			_ = conn.Conn().Close(context.WithoutCancel(ctx))
		}
	}()

	q := store.New(conn)
	bulk, err := im.Source.DefaultCards(ctx)
	if err != nil {
		return Result{}, err
	}
	res := Result{BulkUpdatedAt: bulk.UpdatedAt}
	updatedAt := pgtype.Timestamptz{Time: bulk.UpdatedAt, Valid: true}
	if !force {
		last, err := q.LastImport(ctx)
		switch {
		case err == nil && last.BulkUpdatedAt.Valid && last.BulkUpdatedAt.Time.Equal(bulk.UpdatedAt):
			res.Unchanged = true
			im.Log.InfoContext(ctx, "Scryfall bulk file unchanged since the last import", "updated_at", bulk.UpdatedAt)
			return res, nil
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			return res, err
		}
		failed, err := q.FailedImportsOf(ctx, updatedAt)
		if err != nil {
			return res, err
		}
		if failed >= maxAttemptsPerFile {
			return res, fmt.Errorf("%w (%d attempts at the file from %s); waiting for the next one, or run cmd/sync -force",
				ErrGaveUp, failed, bulk.UpdatedAt.Format(time.RFC3339))
		}
	}

	syncID, err := q.StartSync(ctx, updatedAt)
	if err != nil {
		return res, err
	}
	res, runErr := im.load(ctx, conn.Conn(), q, bulk, res)
	return res, errors.Join(runErr, im.record(ctx, syncID, res, runErr))
}

// record notes how an import ended. It uses its own connection, with its own deadline: if
// the import was cancelled mid-query, its connection may be gone.
func (im *Importer) record(ctx context.Context, syncID int64, res Result, runErr error) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	finish := store.FinishSyncParams{ID: syncID}
	if runErr == nil {
		finish.SetsSeen = int4(res.SetsSeen)
		finish.CardsSeen = int4(res.CardsSeen)
		finish.CardsSkipped = int4(res.CardsSkipped)
		finish.CardsChanged = int4(res.CardsChanged)
		finish.CardsGone = int4(res.CardsGone)
	} else {
		finish.Error = pgtype.Text{String: runErr.Error(), Valid: true}
	}
	if err := store.New(im.Pool).FinishSync(ctx, finish); err != nil {
		return fmt.Errorf("record the import: %w", err)
	}
	return nil
}

func (im *Importer) load(ctx context.Context, conn *pgx.Conn, q *store.Queries, bulk scryfall.BulkFile, res Result) (Result, error) {
	sets, err := im.Source.Sets(ctx)
	if err != nil {
		return res, err
	}
	setRows := make([]store.UpsertSetsParams, 0, len(sets))
	known := make(map[string]bool, len(sets))
	for _, s := range sets {
		row, err := setRow(s)
		if err != nil {
			im.Log.WarnContext(ctx, "skipped a Scryfall set", "code", s.Code, "reason", err)
			continue
		}
		setRows = append(setRows, row)
		known[s.Code] = true
	}
	res.SetsSeen = len(setRows)

	// 1. Download into the staging table, outside any transaction: the download can take
	// minutes, and a transaction open that long holds back vacuum and may be timed out.
	if err := q.ClearStagedCards(ctx); err != nil {
		return res, err
	}
	batch := make([]store.StageCardsParams, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if _, err := q.StageCards(ctx, batch); err != nil {
			return fmt.Errorf("stage cards: %w", err)
		}
		batch = batch[:0]
		return nil
	}
	skip := func(attrs ...any) {
		res.CardsSkipped++
		if res.CardsSkipped <= loggedSkips {
			im.Log.WarnContext(ctx, "skipped a Scryfall card", attrs...)
		}
	}
	err = im.Source.EachCard(ctx, bulk, func(c scryfall.Card) error {
		if c.Digital {
			return nil
		}
		res.CardsSeen++
		if res.CardsSeen > maxCards {
			return fmt.Errorf("the bulk file has more than %d cards", maxCards)
		}
		row, err := toRow(c)
		if err == nil && !known[c.Set] {
			err = fmt.Errorf("unknown set %q", c.Set)
		}
		if err != nil {
			skip("id", c.ID, "name", c.Name, "reason", err)
			return nil
		}
		batch = append(batch, row)
		if len(batch) == batchSize {
			return flush()
		}
		return nil
	}, func(line int, err error) {
		res.CardsSeen++ // it may have been digital, but it can't be told apart
		skip("line", line, "reason", err)
	})
	if err == nil {
		err = flush()
	}
	if err != nil {
		return res, err
	}
	if err := q.AnalyzeStagedCards(ctx); err != nil {
		return res, err
	}
	if res.CardsSeen == 0 || tooMany(res.CardsSkipped, res.CardsSeen) {
		return res, fmt.Errorf("refusing to import: %d of %d cards couldn't be read (see the warnings above)",
			res.CardsSkipped, res.CardsSeen)
	}

	// 2. Apply it all in one short transaction.
	tx, err := conn.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) // after Commit, this does nothing
	qtx := q.WithTx(tx)

	var setErr error
	qtx.UpsertSets(ctx, setRows).Exec(func(i int, err error) { // one round trip for all of them
		if err != nil && setErr == nil {
			setErr = fmt.Errorf("set %s: %w", setRows[i].Code, err)
		}
	})
	if setErr != nil {
		return res, setErr
	}
	counts, err := qtx.CountCards(ctx)
	if err != nil {
		return res, err
	}
	if tooMany(int(counts.Unstaged), int(counts.Present)) {
		return res, fmt.Errorf("refusing to import: %d of %d cards would be marked gone; is the bulk file complete?",
			counts.Unstaged, counts.Present)
	}
	changed, err := qtx.MergeStagedCards(ctx)
	if err != nil {
		return res, fmt.Errorf("merge cards: %w", err)
	}
	res.CardsChanged = int(changed)
	gone, err := qtx.MarkGoneCards(ctx)
	if err != nil {
		return res, fmt.Errorf("mark gone cards: %w", err)
	}
	res.CardsGone = int(gone)
	if err := qtx.ClearStagedCards(ctx); err != nil {
		return res, err
	}
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	im.Log.InfoContext(ctx, "imported Scryfall data", "sets", res.SetsSeen, "cards", res.CardsSeen,
		"skipped", res.CardsSkipped, "changed", res.CardsChanged, "gone", res.CardsGone,
		"bulk_updated_at", res.BulkUpdatedAt)
	return res, nil
}

func tooMany(some, of int) bool {
	return float64(some) > maxSkippedShare*float64(of)
}

// Due reports whether the last successful import finished more than maxAge ago, or there
// hasn't been one. Checks that found the file unchanged don't count, so once an import is
// due, every check imports as soon as Scryfall publishes the next file.
func (im *Importer) Due(ctx context.Context, maxAge time.Duration) (bool, error) {
	last, err := store.New(im.Pool).LastImport(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return time.Since(last.FinishedAt.Time) > maxAge, nil
}

// RunDaily imports whenever the last successful import is a day old (straight away if
// there's never been one), checking every checkEvery, until ctx ends. Failures are logged
// and retried at the next check, up to maxAttemptsPerFile times per bulk file.
//
// Run it in one server process only: in others, it just finds the lock taken.
func (im *Importer) RunDaily(ctx context.Context, checkEvery time.Duration) {
	for {
		due, err := im.Due(ctx, 24*time.Hour)
		if err == nil && due {
			_, err = im.Run(ctx, false)
		}
		switch {
		case err == nil || ctx.Err() != nil:
		case errors.Is(err, ErrAlreadyRunning):
			im.Log.InfoContext(ctx, "a Scryfall import is running elsewhere; will check again", "in", checkEvery)
		case errors.Is(err, ErrGaveUp):
			im.Log.WarnContext(ctx, "not importing Scryfall data", "reason", err)
		default:
			im.Log.ErrorContext(ctx, "Scryfall import failed; will retry", "error", err, "retry_in", checkEvery)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(checkEvery):
		}
	}
}

func int4(n int) pgtype.Int4 {
	return pgtype.Int4{Int32: int32(n), Valid: true}
}
