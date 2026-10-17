package api

import (
	"context"
	"net/http"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// Rates are the latest euro exchange rates (internal/rates).
type Rates interface {
	Latest(ctx context.Context) ([]contract.ExchangeRate, error)
}

// GET /api/rates: public, as the prices are; the app shows them in pounds with it.
func exchangeRates(r Rates) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		list, err := r.Latest(req.Context())
		if list == nil {
			list = []contract.ExchangeRate{} // none yet is an empty list, never null
		}
		respond(w, req, contract.ExchangeRates{Rates: list}, err)
	}
}
