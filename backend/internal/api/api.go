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
	// The signed-in user's collection, and their custom groups.
	Collection   Collection
	CustomGroups CustomGroups
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
	mux.Handle("POST /api/auth/login", limit(l.AuthPerClient, login(s.Auth, l.LoginFailures)))
	mux.HandleFunc("POST /api/auth/logout", logout(s.Auth))
	mux.HandleFunc("GET /api/auth/me", requireUser(s.Auth, me))
	mux.HandleFunc("GET /api/collection/groups", requireUser(s.Auth, collectionGroups(s.Collection)))
	mux.HandleFunc("GET /api/collection/entries", requireUser(s.Auth, collectionEntries(s.Collection)))
	mux.HandleFunc("GET /api/collection/stats", requireUser(s.Auth, collectionStats(s.Collection)))
	mux.HandleFunc("POST /api/collection/entries", requireUser(s.Auth, addEntry(s.Collection)))
	mux.HandleFunc("PATCH /api/collection/entries/{id}", requireUser(s.Auth, changeEntry(s.Collection)))
	mux.HandleFunc("DELETE /api/collection/entries/{id}", requireUser(s.Auth, deleteEntry(s.Collection)))
	mux.HandleFunc("GET /api/groups", requireUser(s.Auth, listGroups(s.CustomGroups)))
	mux.HandleFunc("POST /api/groups", requireUser(s.Auth, createGroup(s.CustomGroups)))
	mux.HandleFunc("GET /api/groups/{id}", requireUser(s.Auth, getGroup(s.CustomGroups)))
	mux.HandleFunc("PATCH /api/groups/{id}", requireUser(s.Auth, changeGroup(s.CustomGroups)))
	mux.HandleFunc("DELETE /api/groups/{id}", requireUser(s.Auth, deleteGroup(s.CustomGroups)))
	mux.HandleFunc("GET /api/groups/{id}/groups", requireUser(s.Auth, groupGroups(s.CustomGroups)))
	mux.HandleFunc("GET /api/groups/{id}/members", requireUser(s.Auth, groupMembers(s.CustomGroups)))
	mux.HandleFunc("GET /api/groups/{id}/members/{entry_id}", requireUser(s.Auth, getMember(s.CustomGroups)))
	mux.HandleFunc("PUT /api/groups/{id}/members/{entry_id}", requireUser(s.Auth, setMember(s.CustomGroups)))
	mux.HandleFunc("DELETE /api/groups/{id}/members/{entry_id}", requireUser(s.Auth, removeMember(s.CustomGroups)))
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
	return securityHeaders(limit(l.PerClient, csrf.Handler(jsonMethodErrors(mux))))
}

// jsonMethodErrors has the router answer a wrong method (405) in JSON, like every other API
// error, rather than in plain text.
func jsonMethodErrors(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, pattern := mux.Handler(r); pattern != "" {
			mux.ServeHTTP(w, r) // a route: its handler answers
			return
		}
		mux.ServeHTTP(&methodErrorWriter{ResponseWriter: w}, r)
	})
}

// methodErrorWriter replaces a 405's plain-text body with a JSON error.
type methodErrorWriter struct {
	http.ResponseWriter
	replaced bool
}

func (m *methodErrorWriter) WriteHeader(code int) {
	if code != http.StatusMethodNotAllowed {
		m.ResponseWriter.WriteHeader(code)
		return
	}
	m.replaced = true
	writeError(m.ResponseWriter, code, "this endpoint doesn't take that method") // the Allow header lists those it takes
}

func (m *methodErrorWriter) Write(b []byte) (int, error) {
	if m.replaced {
		return len(b), nil
	}
	return m.ResponseWriter.Write(b)
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
