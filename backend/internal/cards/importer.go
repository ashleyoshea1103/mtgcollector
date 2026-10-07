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
	EachCard(ctx context.Context, f scryfall.BulkFile, fn func(scryfall.Card) error) error
}

// DefaultLockKey is the Postgres advisory lock that keeps imports from overlapping.
const DefaultLockKey int64 = 0x6d74_6763_7379_6e63 // "mtgcsync"

// ErrAlreadyRunning means another import (in this or another process) holds the lock.
var ErrAlreadyRunning = errors.New("a Scryfall import is already running")

// How many cards are sent to Postgres at a time.
const batchSize = 1000

// How many skipped cards are logged one by one; the rest are only counted.
const loggedSkips = 20

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
}

// Run imports the current bulk file, unless it's the one the last successful import
// already read (force imports it anyway). Sets and cards are replaced in one transaction,
// so a failed import leaves the previous data as it was. Every attempt is recorded in
// scryfall_syncs.
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
	syncID, err := q.StartSync(ctx)
	if err != nil {
		return Result{}, err
	}
	res, runErr := im.run(ctx, conn.Conn(), q, force)

	finish := store.FinishSyncParams{ID: syncID}
	if !res.BulkUpdatedAt.IsZero() {
		finish.BulkUpdatedAt = pgtype.Timestamptz{Time: res.BulkUpdatedAt, Valid: true}
	}
	if !res.Unchanged && runErr == nil {
		finish.SetsSeen = int4(res.SetsSeen)
		finish.CardsSeen = int4(res.CardsSeen)
		finish.CardsSkipped = int4(res.CardsSkipped)
		finish.CardsChanged = int4(res.CardsChanged)
	}
	if runErr != nil {
		finish.Error = pgtype.Text{String: runErr.Error(), Valid: true}
	}
	if err := q.FinishSync(context.WithoutCancel(ctx), finish); err != nil {
		return res, errors.Join(runErr, fmt.Errorf("record the import: %w", err))
	}
	return res, runErr
}

func (im *Importer) run(ctx context.Context, conn *pgx.Conn, q *store.Queries, force bool) (Result, error) {
	var res Result
	bulk, err := im.Source.DefaultCards(ctx)
	if err != nil {
		return res, err
	}
	res.BulkUpdatedAt = bulk.UpdatedAt
	if !force {
		last, err := q.LastSuccessfulSync(ctx)
		switch {
		case err == nil && last.BulkUpdatedAt.Valid && last.BulkUpdatedAt.Time.Equal(bulk.UpdatedAt):
			res.Unchanged = true
			im.Log.InfoContext(ctx, "Scryfall bulk file unchanged since the last import", "updated_at", bulk.UpdatedAt)
			return res, nil
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			return res, err
		}
	}

	sets, err := im.Source.Sets(ctx)
	if err != nil {
		return res, err
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) // after Commit, this does nothing
	qtx := q.WithTx(tx)

	known := make(map[string]bool, len(sets))
	for _, s := range sets {
		row, err := setRow(s)
		if err != nil {
			im.Log.WarnContext(ctx, "skipped a Scryfall set", "code", s.Code, "reason", err)
			continue
		}
		if _, err := qtx.UpsertSet(ctx, row); err != nil {
			return res, fmt.Errorf("set %s: %w", s.Code, err)
		}
		known[s.Code] = true
		res.SetsSeen++
	}

	if err := qtx.ClearStagedCards(ctx); err != nil {
		return res, err
	}
	batch := make([]store.StageCardsParams, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if _, err := qtx.StageCards(ctx, batch); err != nil {
			return fmt.Errorf("stage cards: %w", err)
		}
		batch = batch[:0]
		return nil
	}
	err = im.Source.EachCard(ctx, bulk, func(c scryfall.Card) error {
		if c.Digital {
			return nil
		}
		res.CardsSeen++
		row, err := toRow(c)
		if err == nil && !known[c.Set] {
			err = fmt.Errorf("unknown set %q", c.Set)
		}
		if err != nil {
			res.CardsSkipped++
			if res.CardsSkipped <= loggedSkips {
				im.Log.WarnContext(ctx, "skipped a Scryfall card", "id", c.ID, "name", c.Name, "reason", err)
			}
			return nil
		}
		batch = append(batch, row)
		if len(batch) == batchSize {
			return flush()
		}
		return nil
	})
	if err == nil {
		err = flush()
	}
	if err != nil {
		return res, err
	}

	changed, err := qtx.MergeStagedCards(ctx)
	if err != nil {
		return res, fmt.Errorf("merge cards: %w", err)
	}
	res.CardsChanged = int(changed)
	if err := qtx.ClearStagedCards(ctx); err != nil {
		return res, err
	}
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	im.Log.InfoContext(ctx, "imported Scryfall data", "sets", res.SetsSeen, "cards", res.CardsSeen,
		"skipped", res.CardsSkipped, "changed", res.CardsChanged, "bulk_updated_at", res.BulkUpdatedAt)
	return res, nil
}

// Due reports whether the last successful import finished more than maxAge ago, or there
// hasn't been one.
func (im *Importer) Due(ctx context.Context, maxAge time.Duration) (bool, error) {
	last, err := store.New(im.Pool).LastSuccessfulSync(ctx)
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
// and retried at the next check.
func (im *Importer) RunDaily(ctx context.Context, checkEvery time.Duration) {
	for {
		due, err := im.Due(ctx, 24*time.Hour)
		if err == nil && due {
			_, err = im.Run(ctx, false)
		}
		if err != nil && ctx.Err() == nil {
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
