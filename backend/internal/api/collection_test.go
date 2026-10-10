package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// fakeCollection records what the handlers asked for and answers with err, if set.
type fakeCollection struct {
	err     error
	created bool
	calls   []string
	userID  int64
	id      int64
	entry   contract.NewEntry
	change  contract.EntryChange
	groupBy contract.GroupBy
	query   collection.EntryQuery
}

func (f *fakeCollection) call(name string, userID int64) {
	f.calls, f.userID = append(f.calls, name), userID
}

func (f *fakeCollection) Add(_ context.Context, userID int64, e contract.NewEntry) (contract.CollectionEntry, bool, error) {
	f.call("add", userID)
	f.entry = e
	return contract.CollectionEntry{ID: 3, Quantity: e.Quantity}, f.created, f.err
}

func (f *fakeCollection) Change(_ context.Context, userID, id int64, c contract.EntryChange) (contract.CollectionEntry, error) {
	f.call("change", userID)
	f.id, f.change = id, c
	return contract.CollectionEntry{ID: id}, f.err
}

func (f *fakeCollection) Delete(_ context.Context, userID, id int64) error {
	f.call("delete", userID)
	f.id = id
	return f.err
}

func (f *fakeCollection) Groups(_ context.Context, userID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	f.call("groups", userID)
	f.groupBy = by
	return contract.CollectionGroups{GroupBy: by, Groups: []contract.GroupSummary{}}, f.err
}

func (f *fakeCollection) Entries(_ context.Context, userID int64, q collection.EntryQuery) (contract.EntryPage, error) {
	f.call("entries", userID)
	f.query = q
	return contract.EntryPage{Entries: []contract.CollectionEntry{}}, f.err
}

func (f *fakeCollection) Stats(_ context.Context, userID int64) (contract.CollectionStats, error) {
	f.call("stats", userID)
	return contract.CollectionStats{ByColor: map[string]int{}, ByRarity: map[contract.Rarity]int{}}, f.err
}

func collectionHandler(c *fakeCollection) http.Handler {
	return NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: &fakeAuth{}, Collection: c})
}

var signedIn = []string{"Cookie", sessionCookie + "=" + testToken}

// Every collection route, with a body where it takes one.
var collectionRoutes = []struct{ method, path, body string }{
	{http.MethodGet, "/api/collection/groups", ""},
	{http.MethodGet, "/api/collection/entries", ""},
	{http.MethodGet, "/api/collection/stats", ""},
	{http.MethodPost, "/api/collection/entries", `{"card_id":"x","quantity":1,"finish":"foil","condition":"NM","language":"en","group_id":null}`},
	{http.MethodPatch, "/api/collection/entries/5", `{"quantity":2}`},
	{http.MethodDelete, "/api/collection/entries/5", ""},
}

func TestTheCollectionNeedsASignedInUser(t *testing.T) {
	for _, r := range collectionRoutes {
		c := &fakeCollection{}
		rec := send(t, collectionHandler(c), r.method, r.path, r.body)
		if rec.Code != http.StatusUnauthorized || len(c.calls) != 0 {
			t.Errorf("%s %s without a session = %d, calls %v; want 401 and no call", r.method, r.path, rec.Code, c.calls)
		}
	}
}

func TestEachCollectionRouteIsForTheSignedInUser(t *testing.T) {
	for _, r := range collectionRoutes {
		c := &fakeCollection{}
		rec := send(t, collectionHandler(c), r.method, r.path, r.body, signedIn...)
		if rec.Code >= 300 || len(c.calls) != 1 || c.userID != testUser.ID {
			t.Errorf("%s %s = %d %s, calls %v for user %d; want one call for user %d", r.method, r.path, rec.Code, rec.Body, c.calls, c.userID, testUser.ID)
		}
	}
}

func TestListingsPassTheirParametersOn(t *testing.T) {
	c := &fakeCollection{}
	send(t, collectionHandler(c), http.MethodGet, "/api/collection/groups?group_by=color", "", signedIn...)
	if c.groupBy != contract.GroupByColor {
		t.Errorf("group_by = %q", c.groupBy)
	}
	send(t, collectionHandler(c), http.MethodGet, "/api/collection/groups", "", signedIn...)
	if c.groupBy != contract.GroupByNone {
		t.Errorf("no group_by = %q, want none", c.groupBy)
	}
	send(t, collectionHandler(c), http.MethodGet, "/api/collection/entries?group_by=set&key=mh2&sort=price&cursor=abc", "", signedIn...)
	if want := (collection.EntryQuery{GroupBy: "set", Key: "mh2", Sort: "price", Cursor: "abc"}); c.query != want {
		t.Errorf("query = %+v, want %+v", c.query, want)
	}
}

func TestAddingSaysWhetherTheEntryIsNew(t *testing.T) {
	body := `{"card_id":"0b8fe8b3-0000-4000-8000-000000000000","quantity":4,"finish":"etched","condition":"LP","language":"ja","group_id":null}`
	for created, want := range map[bool]int{true: http.StatusCreated, false: http.StatusOK} {
		c := &fakeCollection{created: created}
		rec := send(t, collectionHandler(c), http.MethodPost, "/api/collection/entries", body, signedIn...)
		if rec.Code != want {
			t.Errorf("created %v: status %d, want %d", created, rec.Code, want)
		}
		if w := (contract.NewEntry{CardID: "0b8fe8b3-0000-4000-8000-000000000000", Quantity: 4, Finish: "etched", Condition: "LP", Language: "ja"}); c.entry != w {
			t.Errorf("entry = %+v, want %+v", c.entry, w)
		}
	}
}

func TestAChangeIsForTheEntryInThePath(t *testing.T) {
	c := &fakeCollection{}
	rec := send(t, collectionHandler(c), http.MethodPatch, "/api/collection/entries/42", `{"condition":"EX","language":"de"}`, signedIn...)
	if rec.Code != http.StatusOK || c.id != 42 || c.change.Condition == nil || *c.change.Condition != "EX" ||
		*c.change.Language != "de" || c.change.Quantity != nil || c.change.Finish != nil {
		t.Errorf("= %d, id %d, change %+v", rec.Code, c.id, c.change)
	}
	rec = send(t, collectionHandler(c), http.MethodDelete, "/api/collection/entries/43", "", signedIn...)
	if rec.Code != http.StatusNoContent || c.id != 43 || rec.Body.Len() != 0 {
		t.Errorf("delete = %d %q, id %d; want 204 for 43", rec.Code, rec.Body, c.id)
	}
}

func TestAnEntryIDThatCantBeOneIsA404(t *testing.T) {
	for _, id := range []string{"abc", "0", "-1", "1.5", "99999999999999999999"} {
		for _, method := range []string{http.MethodPatch, http.MethodDelete} {
			c := &fakeCollection{}
			rec := send(t, collectionHandler(c), method, "/api/collection/entries/"+id, `{"quantity":1}`, signedIn...)
			if rec.Code != http.StatusNotFound || len(c.calls) != 0 || assertJSONError(t, rec.Body.String()) != "no such entry" {
				t.Errorf("%s entry %s = %d %s, calls %v; want 404 and no call", method, id, rec.Code, rec.Body, c.calls)
			}
		}
	}
}

func TestBadEntryBodiesAreRefusedWithTheReason(t *testing.T) {
	for _, tc := range []struct{ body, msg string }{
		{`{"card_id":"x","quantity":1,"finish":"shiny","condition":"NM","language":"en","group_id":null}`, "finish must be one of nonfoil, foil, etched"},
		{`{"card_id":"x","quantity":1,"finish":"foil","condition":"mint","language":"en","group_id":null}`, "condition must be one of MT, NM, EX, GD, LP, PL, PO"},
		{`{"card_id":"x","quantity":1,"finish":"foil","condition":"NM","language":"klingon","group_id":null}`, "language must be one of en, de,"},
		{`{"card_id":"x","quantity":"1","finish":"foil","condition":"NM","language":"en","group_id":null}`, "quantity has the wrong type"},
		{`{"card_id":"x","quantity":1,"finish":"foil","condition":"NM","language":"en","owner":1}`, "the body isn't the JSON this endpoint takes"},
	} {
		c := &fakeCollection{}
		rec := send(t, collectionHandler(c), http.MethodPost, "/api/collection/entries", tc.body, signedIn...)
		if got := assertJSONError(t, rec.Body.String()); rec.Code != http.StatusBadRequest || !strings.HasPrefix(got, tc.msg) || len(c.calls) != 0 {
			t.Errorf("%s = %d %q, calls %v; want 400 %q", tc.body, rec.Code, got, c.calls, tc.msg)
		}
	}
}

func TestCollectionErrorsGetTheirStatus(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		msg    string
	}{
		{apperr.New(apperr.Invalid, "quantity must be from 1 to 999"), 400, "quantity must be from 1 to 999"},
		{collection.ErrNotFound, 404, "no such entry"},
		{collection.ErrConflict, 409, collection.ErrConflict.Error()},
		{context.DeadlineExceeded, 503, "that took too long; try again"},
		{errors.New("ERROR: secret_table"), 500, "something went wrong"},
	} {
		for _, r := range collectionRoutes {
			rec := send(t, collectionHandler(&fakeCollection{err: tc.err}), r.method, r.path, r.body, signedIn...)
			if rec.Code != tc.status || assertJSONError(t, rec.Body.String()) != tc.msg {
				t.Errorf("%v, %s %s = %d %s; want %d %q", tc.err, r.method, r.path, rec.Code, rec.Body, tc.status, tc.msg)
			}
		}
	}
}

func TestCrossOriginCollectionChangesAreRefused(t *testing.T) {
	for _, r := range collectionRoutes[3:] {
		c := &fakeCollection{}
		rec := send(t, collectionHandler(c), r.method, r.path, r.body, append([]string{"Sec-Fetch-Site", "cross-site"}, signedIn...)...)
		if rec.Code != http.StatusForbidden || len(c.calls) != 0 {
			t.Errorf("%s %s from another site = %d, calls %v; want 403", r.method, r.path, rec.Code, c.calls)
		}
	}
}
