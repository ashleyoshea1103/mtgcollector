package rates

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// How old the last fetch may be before the next: the ECB publishes once a working day, so a
// few small fetches a day catch each new rate within hours.
const refreshAfter = 6 * time.Hour

// Service keeps the latest rates in the database and serves them.
type Service struct {
	Pool   *pgxpool.Pool
	Source Source
	Log    *slog.Logger
}

// Latest is the stored rates, by currency: empty (never nil) until one has been fetched.
func (s *Service) Latest(ctx context.Context) ([]contract.ExchangeRate, error) {
	rows, err := store.New(s.Pool).ListExchangeRates(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]contract.ExchangeRate, 0, len(rows))
	for _, r := range rows {
		out = append(out, contract.ExchangeRate{Currency: r.Currency, PerEUR: r.PerEur, Date: r.RateDate})
	}
	return out, nil
}

// Refresh fetches the rate and stores it. A failed fetch writes nothing, so the last good
// rate stays.
func (s *Service) Refresh(ctx context.Context) error {
	r, err := s.Source.Daily(ctx)
	if err != nil {
		return err
	}
	return store.New(s.Pool).UpsertExchangeRate(ctx, store.UpsertExchangeRateParams{
		Currency: r.Currency,
		PerEur:   r.PerEUR,
		RateDate: pgtype.Date{Time: r.Date, Valid: true},
	})
}

// Due says whether rates should be fetched: never yet, or not for maxAge.
func (s *Service) Due(ctx context.Context, maxAge time.Duration) (bool, error) {
	last, err := store.New(s.Pool).LastRateFetch(ctx)
	if err != nil {
		return false, err
	}
	return !last.Valid || time.Since(last.Time) > maxAge, nil
}

// RunDaily fetches the rate whenever the last fetch is 6 hours old (straight away if there's
// never been one), checking every checkEvery, until ctx ends. A failure is logged and the
// last good rate kept; the next check tries again.
func (s *Service) RunDaily(ctx context.Context, checkEvery time.Duration) {
	for {
		due, err := s.Due(ctx, refreshAfter)
		if err == nil && due {
			err = s.Refresh(ctx)
		}
		if err != nil && ctx.Err() == nil {
			s.Log.WarnContext(ctx, "couldn't refresh the exchange rate; keeping the last one", "error", err, "retry_in", checkEvery)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(checkEvery):
		}
	}
}
