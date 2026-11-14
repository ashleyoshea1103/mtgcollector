package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// fakeRates answers Latest with rates, or err.
type fakeRates struct {
	rates []contract.ExchangeRate
	err   error
}

func (f *fakeRates) Latest(context.Context) ([]contract.ExchangeRate, error) { return f.rates, f.err }

func TestRatesServesTheLatest(t *testing.T) {
	r := &fakeRates{rates: []contract.ExchangeRate{{Currency: "GBP", PerEUR: 0.8712, Date: "2026-10-10"}}}
	rec := get(t, NewHandler(Services{DB: &fakeDB{}, Rates: r}), http.MethodGet, "/api/rates")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	if got, want := rec.Body.String(), `{"rates":[{"currency":"GBP","per_eur":0.8712,"date":"2026-10-10"}]}`+"\n"; got != want {
		t.Errorf("body = %s, want %s", got, want)
	}
}

func TestRatesWithNoneYetIsAnEmptyList(t *testing.T) {
	// Even if the service hands back nil, the app gets a list.
	rec := get(t, NewHandler(Services{DB: &fakeDB{}, Rates: &fakeRates{}}), http.MethodGet, "/api/rates")
	if got, want := rec.Body.String(), `{"rates":[]}`+"\n"; rec.Code != http.StatusOK || got != want {
		t.Errorf("GET /api/rates = %d %s, want 200 %s", rec.Code, got, want)
	}
}

func TestRatesFailingIsAServerError(t *testing.T) {
	rec := get(t, NewHandler(Services{DB: &fakeDB{}, Rates: &fakeRates{err: errors.New("connection refused")}}), http.MethodGet, "/api/rates")
	if rec.Code < 500 || !strings.Contains(rec.Body.String(), `"error"`) {
		t.Errorf("GET /api/rates = %d %s, want a 5xx with an error", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "connection refused") {
		t.Errorf("the body tells the caller the server's error: %s", rec.Body)
	}
}
