// Package api is the HTTP API: its routes, handlers and the headers every response gets.
package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// Pinger checks that the database is reachable. *pgxpool.Pool satisfies it.
type Pinger interface {
	Ping(ctx context.Context) error
}

// How long the health check waits for the database before reporting it unavailable.
const healthTimeout = 2 * time.Second

// NewHandler returns the API's routes, all under /api/.
func NewHandler(db Pinger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", health(db))
	return securityHeaders(mux)
}

func health(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthTimeout)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			// The reason goes to the log, not to the (unauthenticated) caller.
			slog.WarnContext(ctx, "health check: database unavailable", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, contract.Health{Status: contract.HealthStatusUnavailable})
			return
		}
		writeJSON(w, http.StatusOK, contract.Health{Status: contract.HealthStatusOK})
	}
}

// securityHeaders sets headers for responses that are only ever JSON: nothing in
// them may load, run or be framed, sniffed as another type, or cached.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}
