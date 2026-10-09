package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type fakeDB struct {
	err      error
	deadline time.Time // of the context Ping was called with
	called   bool
}

func (f *fakeDB) Ping(ctx context.Context) error {
	f.called = true
	f.deadline, _ = ctx.Deadline()
	return f.err
}

func get(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

func TestHealthReportsOKWhenTheDatabaseAnswers(t *testing.T) {
	rec := get(t, NewHandler(&fakeDB{}, &fakeCards{}), http.MethodGet, "/api/health")

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := rec.Body.String(); got != `{"status":"ok"}`+"\n" {
		t.Errorf("body = %q", got)
	}
}

func TestHealthReportsUnavailableWithoutLeakingTheReason(t *testing.T) {
	db := &fakeDB{err: errors.New(`failed to connect to user=secret-user database=secret-db`)}
	rec := get(t, NewHandler(db, &fakeCards{}), http.MethodGet, "/api/health")

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
	if got := rec.Body.String(); got != `{"status":"unavailable"}`+"\n" {
		t.Errorf("body = %q", got)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Error("the database error reached the response")
	}
}

func TestHealthGivesTheDatabaseABoundedTime(t *testing.T) {
	db := &fakeDB{}
	get(t, NewHandler(db, &fakeCards{}), http.MethodGet, "/api/health")
	end := time.Now()

	if db.deadline.IsZero() {
		t.Fatal("Ping got a context without a deadline, so a hung database would hang the health check")
	}
	// The deadline was set during the request, so it's at most healthTimeout after the request ended.
	if over := db.deadline.Sub(end); over > healthTimeout {
		t.Errorf("Ping deadline is %v after the request ended, want at most %v", over, healthTimeout)
	}
}

func TestEveryResponseGetsTheSecurityHeaders(t *testing.T) {
	want := map[string]string{
		"Content-Security-Policy":      "default-src 'none'; frame-ancestors 'none'",
		"X-Content-Type-Options":       "nosniff",
		"Referrer-Policy":              "no-referrer",
		"Cache-Control":                "no-store",
		"Cross-Origin-Resource-Policy": "same-origin",
	}
	for _, tc := range []struct{ name, method, path string }{
		{"a route", http.MethodGet, "/api/health"},
		{"an unknown route", http.MethodGet, "/api/nope"},
		{"a wrong method", http.MethodPost, "/api/health"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := get(t, NewHandler(&fakeDB{}, &fakeCards{}), tc.method, tc.path)
			for k, v := range want {
				if got := rec.Header().Get(k); got != v {
					t.Errorf("%s = %q, want %q", k, got, v)
				}
			}
		})
	}
}

func TestOnlyGETReachesTheHealthCheck(t *testing.T) {
	db := &fakeDB{}
	rec := get(t, NewHandler(db, &fakeCards{}), http.MethodPost, "/api/health")

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
	if db.called {
		t.Error("POST reached the database")
	}
}

func TestHealthWithARealPoolAndNoServer(t *testing.T) {
	// Port 1 on loopback: nothing listens there, so every connection attempt is refused.
	pool, err := pgxpool.New(t.Context(), "postgres://nobody@127.0.0.1:1/nothing?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	rec := get(t, NewHandler(pool, &fakeCards{}), http.MethodGet, "/api/health")

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}
