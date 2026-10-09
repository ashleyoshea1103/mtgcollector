//go:build integration

package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

func TestHealthAgainstARealDatabase(t *testing.T) {
	srv := httptest.NewServer(NewHandler(testdb.New(t), nil))
	t.Cleanup(srv.Close)

	res, err := http.Get(srv.URL + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	if res.StatusCode != http.StatusOK || string(body) != `{"status":"ok"}`+"\n" {
		t.Errorf("GET /api/health = %d %q, want 200 {\"status\":\"ok\"}", res.StatusCode, body)
	}
}

// The card routes reach the real searcher and its SQL (internal/cards has the search's own
// tests, with cards in the database; this one checks the wiring).
func TestCardRoutesAgainstARealDatabase(t *testing.T) {
	pool := testdb.New(t)
	srv := httptest.NewServer(NewHandler(pool, &cards.Searcher{Q: store.New(pool)}))
	t.Cleanup(srv.Close)

	for _, tc := range []struct {
		path   string
		status int
		body   string
	}{
		{"/api/cards/search?q=lightning+bolt", 200, `{"cards":[],"page":1,"has_more":false}`},
		{"/api/cards/search?set=mh2&page=2", 200, `{"cards":[],"page":2,"has_more":false}`},
		{"/api/cards/autocomplete?q=light", 200, `{"names":[]}`},
		{"/api/cards/00000000-0000-4000-8000-000000000000", 404, `{"error":"no card with that id"}`},
		{"/api/cards/00000000-0000-4000-8000-000000000000/printings", 404, `{"error":"no card with that id"}`},
		{"/api/cards/search?q=a", 400, `{"error":"give a name with at least 3 letters in a row, or a set"}`},
	} {
		res, err := http.Get(srv.URL + tc.path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.status || string(body) != tc.body+"\n" {
			t.Errorf("GET %s = %d %s, want %d %s", tc.path, res.StatusCode, body, tc.status, tc.body)
		}
	}
}
