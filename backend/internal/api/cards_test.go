package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// fakeCards records what the handlers asked for and answers with err, if set.
type fakeCards struct {
	err    error
	search cards.Search
	typed  string
	id     string
	page   int
	calls  []string
}

func (f *fakeCards) Search(_ context.Context, q cards.Search) (contract.CardPage, error) {
	f.calls, f.search = append(f.calls, "search"), q
	return contract.CardPage{Cards: []contract.CardSummary{}, Page: q.Page}, f.err
}

func (f *fakeCards) Autocomplete(_ context.Context, typed string) (contract.CardNames, error) {
	f.calls, f.typed = append(f.calls, "autocomplete"), typed
	return contract.CardNames{Names: []string{"Lightning Bolt"}}, f.err
}

func (f *fakeCards) Card(_ context.Context, id string) (contract.Card, error) {
	f.calls, f.id = append(f.calls, "card"), id
	return contract.Card{CardSummary: contract.CardSummary{ID: id}}, f.err
}

func (f *fakeCards) Printings(_ context.Context, id string, page int) (contract.CardPage, error) {
	f.calls, f.id, f.page = append(f.calls, "printings"), id, page
	return contract.CardPage{Cards: []contract.CardSummary{}, Page: page}, f.err
}

func TestSearchPassesEveryFilterOn(t *testing.T) {
	c := &fakeCards{}
	rec := get(t, NewHandler(&fakeDB{}, c), http.MethodGet,
		"/api/cards/search?q=lightning+bolt&set=M10&type=instant&rarity=common&colors=r&extras=true&page=3")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	want := cards.Search{Name: "lightning bolt", Set: "M10", Type: "instant", Rarity: "common", Colors: "r", IncludeExtras: true, Page: 3}
	if c.search != want {
		t.Errorf("search = %+v\nwant     %+v", c.search, want)
	}
	if got := rec.Body.String(); got != `{"cards":[],"page":3,"has_more":false}`+"\n" {
		t.Errorf("body = %s", got)
	}
}

func TestSearchDefaultsToPageOneWithoutExtras(t *testing.T) {
	c := &fakeCards{}
	get(t, NewHandler(&fakeDB{}, c), http.MethodGet, "/api/cards/search?q=bolt")
	if c.search.Page != 1 || c.search.IncludeExtras {
		t.Errorf("search = %+v, want page 1 without extras", c.search)
	}
}

func TestBadParametersAreRefusedBeforeTheSearch(t *testing.T) {
	for _, path := range []string{
		"/api/cards/search?q=bolt&page=two",
		"/api/cards/search?q=bolt&page=1.5",
		"/api/cards/search?q=bolt&extras=maybe",
		"/api/cards/0b8fe8b3-0000-4000-8000-000000000000/printings?page=x",
	} {
		t.Run(path, func(t *testing.T) {
			c := &fakeCards{}
			rec := get(t, NewHandler(&fakeDB{}, c), http.MethodGet, path)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			assertJSONError(t, rec.Body.String())
			if len(c.calls) > 0 {
				t.Errorf("reached the searcher: %v", c.calls)
			}
		})
	}
}

func TestErrorsBecomeTheRightStatus(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{"the caller's mistake", &cards.QueryError{Reason: "set must be a set code, like mh2"}, 400, "set must be a set code, like mh2"},
		{"a wrapped mistake", fmt.Errorf("parse: %w", &cards.QueryError{Reason: "page must be from 1 to 50"}), 400, "page must be from 1 to 50"},
		{"an unknown card", cards.ErrNotFound, 404, "no card with that id"},
		{"a slow query", fmt.Errorf("search: %w", context.DeadlineExceeded), 503, "that took too long; try a narrower search"},
		// What Postgres says when pgx cancels a query whose time ran out.
		{"a query Postgres cancelled", fmt.Errorf("search: %w", &pgconn.PgError{Code: "57014", Message: "canceling statement due to user request"}), 503, "that took too long; try a narrower search"},
		{"anything else", errors.New(`ERROR: relation "secret_table" does not exist`), 500, "something went wrong"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, path := range []string{"/api/cards/search?q=bolt", "/api/cards/autocomplete?q=bol", "/api/cards/x", "/api/cards/x/printings"} {
				rec := get(t, NewHandler(&fakeDB{}, &fakeCards{err: tc.err}), http.MethodGet, path)
				if rec.Code != tc.status {
					t.Errorf("%s: status = %d, want %d", path, rec.Code, tc.status)
				}
				if got := assertJSONError(t, rec.Body.String()); got != tc.body {
					t.Errorf("%s: error = %q, want %q", path, got, tc.body)
				}
				if strings.Contains(rec.Body.String(), "secret") {
					t.Errorf("%s: an internal error reached the response", path)
				}
			}
		})
	}
}

func TestEachCardRouteReachesItsHandler(t *testing.T) {
	for _, tc := range []struct{ path, call, id string }{
		// "search" and "autocomplete" are routes of their own, not card ids.
		{"/api/cards/search?q=bolt", "search", ""},
		{"/api/cards/autocomplete?q=bol", "autocomplete", ""},
		{"/api/cards/0b8fe8b3-0000-4000-8000-000000000000", "card", "0b8fe8b3-0000-4000-8000-000000000000"},
		{"/api/cards/0b8fe8b3-0000-4000-8000-000000000000/printings?page=2", "printings", "0b8fe8b3-0000-4000-8000-000000000000"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			c := &fakeCards{}
			rec := get(t, NewHandler(&fakeDB{}, c), http.MethodGet, tc.path)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", rec.Code, rec.Body)
			}
			if len(c.calls) != 1 || c.calls[0] != tc.call || c.id != tc.id {
				t.Errorf("calls = %v with id %q, want %s with %q", c.calls, c.id, tc.call, tc.id)
			}
			if tc.call == "printings" && c.page != 2 {
				t.Errorf("page = %d, want 2", c.page)
			}
			if tc.call == "autocomplete" && c.typed != "bol" {
				t.Errorf("typed = %q, want bol", c.typed)
			}
		})
	}
}

func TestUnknownAPIPathsAreJSON404s(t *testing.T) {
	for _, path := range []string{"/api/nope", "/api/cards/x/y/z", "/api/"} {
		rec := get(t, NewHandler(&fakeDB{}, &fakeCards{}), http.MethodGet, path)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", path, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
			t.Errorf("%s: Content-Type = %q", path, ct)
		}
		assertJSONError(t, rec.Body.String())
	}
}

func TestOnlyGETReachesTheCards(t *testing.T) {
	c := &fakeCards{}
	rec := get(t, NewHandler(&fakeDB{}, c), http.MethodPost, "/api/cards/search?q=bolt")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
	if len(c.calls) > 0 {
		t.Errorf("POST reached the searcher: %v", c.calls)
	}
}

// assertJSONError checks body is a contract.APIError and returns its message.
func assertJSONError(t *testing.T, body string) string {
	t.Helper()
	var e contract.APIError
	dec := json.NewDecoder(strings.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&e); err != nil || e.Error == "" {
		t.Errorf("body %q isn't an API error: %v", body, err)
	}
	return e.Error
}
