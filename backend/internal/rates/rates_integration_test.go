//go:build integration

package rates

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// fakeSource answers Daily with rate, or err.
type fakeSource struct {
	rate Rate
	err  error
}

func (f *fakeSource) Daily(context.Context) (Rate, error) { return f.rate, f.err }

func gbp(perEUR float64, y int, m time.Month, d int) Rate {
	return Rate{Currency: "GBP", PerEUR: perEUR, Date: time.Date(y, m, d, 0, 0, 0, 0, time.UTC)}
}

func newService(t *testing.T, src Source) *Service {
	return &Service{Pool: testdb.New(t), Source: src, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func latest(t *testing.T, s *Service) []contract.ExchangeRate {
	t.Helper()
	got, err := s.Latest(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestRefreshStoresTheRate(t *testing.T) {
	src := &fakeSource{rate: gbp(0.8712, 2026, 10, 9)}
	s := newService(t, src)
	if got := latest(t, s); got == nil || len(got) != 0 {
		t.Fatalf("before any fetch: %#v, want an empty list (not nil)", got)
	}
	if err := s.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	want := []contract.ExchangeRate{{Currency: "GBP", PerEUR: 0.8712, Date: "2026-10-09"}}
	if got := latest(t, s); !slices.Equal(got, want) {
		t.Errorf("got %#v, want %#v", got, want)
	}
}

func TestAnOlderFileDoesntReplaceANewerRate(t *testing.T) {
	src := &fakeSource{rate: gbp(0.8712, 2026, 10, 9)}
	s := newService(t, src)
	if err := s.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	// Make the first fetch look old, so the second one is seen to move fetched_at.
	if _, err := s.Pool.Exec(t.Context(), "UPDATE exchange_rates SET fetched_at = now() - interval '2 hours'"); err != nil {
		t.Fatal(err)
	}
	src.rate = gbp(0.85, 2026, 10, 8)
	if err := s.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	want := []contract.ExchangeRate{{Currency: "GBP", PerEUR: 0.8712, Date: "2026-10-09"}}
	if got := latest(t, s); !slices.Equal(got, want) {
		t.Errorf("got %#v, want the newer rate kept, %#v", got, want)
	}
	if due, err := s.Due(t.Context(), time.Hour); err != nil || due {
		t.Errorf("Due(1h) = %v, %v; want false: the fetch counts even though its rate was older", due, err)
	}
}

func TestAFailedFetchKeepsTheLastRate(t *testing.T) {
	src := &fakeSource{rate: gbp(0.8712, 2026, 10, 9)}
	s := newService(t, src)
	if err := s.Refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	before := latest(t, s)
	src.err = ErrInvalid
	if err := s.Refresh(t.Context()); !errors.Is(err, ErrInvalid) {
		t.Errorf("Refresh = %v, want the fetch's error", err)
	}
	if got := latest(t, s); !slices.Equal(got, before) {
		t.Errorf("got %#v after a failed fetch, want %#v kept", got, before)
	}
}

func TestDue(t *testing.T) {
	s := newService(t, &fakeSource{rate: gbp(0.8712, 2026, 10, 9)})
	ctx := t.Context()
	if due, err := s.Due(ctx, 6*time.Hour); err != nil || !due {
		t.Errorf("with no rate: Due = %v, %v; want true", due, err)
	}
	if err := s.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if due, err := s.Due(ctx, 6*time.Hour); err != nil || due {
		t.Errorf("just after a fetch: Due(6h) = %v, %v; want false", due, err)
	}
	if due, err := s.Due(ctx, 0); err != nil || !due {
		t.Errorf("Due(0) = %v, %v; want true", due, err)
	}
}
