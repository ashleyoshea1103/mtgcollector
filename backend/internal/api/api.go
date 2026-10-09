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

// Services are what the API's handlers use.
type Services struct {
	DB    Pinger
	Cards Cards
	Auth  Auth
	// Limits on how often clients may call the API; nil means DefaultLimits().
	Limits *Limits
}

// NewHandler returns the API's routes, all under /api/.
func NewHandler(s Services) http.Handler {
	l := s.Limits
	if l == nil {
		l = DefaultLimits()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", health(s.DB))
	mux.HandleFunc("GET /api/cards/search", searchCards(s.Cards))
	mux.HandleFunc("GET /api/cards/autocomplete", autocomplete(s.Cards))
	mux.HandleFunc("GET /api/cards/{id}", getCard(s.Cards))
	mux.HandleFunc("GET /api/cards/{id}/printings", printings(s.Cards))
	mux.Handle("POST /api/auth/signup", limit(l.AuthPerClient, signup(s.Auth)))
	mux.Handle("POST /api/auth/login", limit(l.AuthPerClient, login(s.Auth, l.LoginPerEmail)))
	mux.HandleFunc("POST /api/auth/logout", logout(s.Auth))
	mux.HandleFunc("GET /api/auth/me", requireUser(s.Auth, me))
	// Anything else under /api/ is a JSON 404, like every other API error.
	// (GET only: a wrong method on a real route still gets 405.)
	mux.HandleFunc("GET /api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "no such API endpoint")
	})

	// Browsers send the session cookie with requests other sites make, so writes (anything
	// but GET, HEAD and OPTIONS) from another origin are refused, by their Sec-Fetch-Site or
	// Origin header. The session cookie is SameSite=Lax as well.
	csrf := http.NewCrossOriginProtection()
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusForbidden, "cross-origin requests can't change anything")
	}))
	return securityHeaders(limit(l.PerClient, csrf.Handler(mux)))
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
// them may load, run or be framed, sniffed as another type, cached, or used by other sites.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		h.Set("Cross-Origin-Resource-Policy", "same-origin") // other sites can't load responses, e.g. as a <script>
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
