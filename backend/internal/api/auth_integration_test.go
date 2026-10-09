//go:build integration

package api

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// A browser's view of signing up, in and out, through the real service and database. Over
// TLS, as the session cookie is Secure.
func TestSigningUpInAndOutAgainstARealDatabase(t *testing.T) {
	pool := testdb.New(t)
	srv := httptest.NewTLSServer(NewHandler(Services{DB: pool, Auth: auth.NewService(store.New(pool))}))
	t.Cleanup(srv.Close)
	client := srv.Client()
	client.Jar, _ = cookiejar.New(nil)

	call := func(method, path, body string, wantStatus int, wantBody string) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != wantStatus || !strings.Contains(string(got), wantBody) {
			t.Fatalf("%s %s = %d %s, want %d %s", method, path, res.StatusCode, got, wantStatus, wantBody)
		}
	}
	creds := `{"email":"ann@example.com","password":"correct horse battery staple"}`

	call("GET", "/api/auth/me", "", 401, "not signed in")
	call("POST", "/api/auth/signup", creds, 201, `"email":"ann@example.com"`)
	call("GET", "/api/auth/me", "", 200, `"email":"ann@example.com"`)
	call("POST", "/api/auth/signup", creds, 409, "already exists")
	call("POST", "/api/auth/logout", "", 204, "")
	call("GET", "/api/auth/me", "", 401, "not signed in")
	call("POST", "/api/auth/login", `{"email":"ann@example.com","password":"wrong but long enough"}`, 401, "incorrect")
	call("POST", "/api/auth/login", creds, 200, `"email":"ann@example.com"`)
	call("GET", "/api/auth/me", "", 200, `"email":"ann@example.com"`)

	var sessions int
	pool.QueryRow(t.Context(), `SELECT count(*) FROM sessions`).Scan(&sessions)
	if sessions != 1 {
		t.Errorf("%d sessions in the database, want 1: logging out (and in again) should end the old one", sessions)
	}
}
