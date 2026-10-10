package api

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// fakeGroups records what the handlers asked for and answers with err, if set.
type fakeGroups struct {
	err              error
	created          bool
	calls            []string
	userID           int64
	groupID, entryID int64
	quantity         int
	newGroup         contract.NewGroup
	change           contract.GroupChange
	groupBy          contract.GroupBy
	query            collection.EntryQuery
}

func (f *fakeGroups) call(name string, userID int64) {
	f.calls, f.userID = append(f.calls, name), userID
}

func (f *fakeGroups) ListGroups(_ context.Context, userID int64) (contract.CustomGroupList, error) {
	f.call("list", userID)
	return contract.CustomGroupList{Groups: []contract.CustomGroup{}}, f.err
}

func (f *fakeGroups) Group(_ context.Context, userID, id int64) (contract.CustomGroup, error) {
	f.call("group", userID)
	f.groupID = id
	return contract.CustomGroup{ID: id, PreviewImages: []string{}}, f.err
}

func (f *fakeGroups) CreateGroup(_ context.Context, userID int64, g contract.NewGroup) (contract.CustomGroup, error) {
	f.call("create", userID)
	f.newGroup = g
	return contract.CustomGroup{ID: 9, Name: g.Name, PreviewImages: []string{}}, f.err
}

func (f *fakeGroups) ChangeGroup(_ context.Context, userID, id int64, c contract.GroupChange) (contract.CustomGroup, error) {
	f.call("change", userID)
	f.groupID, f.change = id, c
	return contract.CustomGroup{ID: id, PreviewImages: []string{}}, f.err
}

func (f *fakeGroups) DeleteGroup(_ context.Context, userID, id int64) error {
	f.call("delete", userID)
	f.groupID = id
	return f.err
}

func (f *fakeGroups) GroupGroups(_ context.Context, userID, groupID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	f.call("groups", userID)
	f.groupID, f.groupBy = groupID, by
	return contract.CollectionGroups{GroupBy: by, Groups: []contract.GroupSummary{}}, f.err
}

func (f *fakeGroups) Members(_ context.Context, userID, groupID int64, q collection.EntryQuery) (contract.GroupMemberPage, error) {
	f.call("members", userID)
	f.groupID, f.query = groupID, q
	return contract.GroupMemberPage{Members: []contract.GroupMember{}}, f.err
}

func (f *fakeGroups) SetMember(_ context.Context, userID, groupID, entryID int64, quantity int) (contract.GroupMember, bool, error) {
	f.call("set member", userID)
	f.groupID, f.entryID, f.quantity = groupID, entryID, quantity
	return contract.GroupMember{Quantity: quantity}, f.created, f.err
}

func (f *fakeGroups) RemoveMember(_ context.Context, userID, groupID, entryID int64) error {
	f.call("remove member", userID)
	f.groupID, f.entryID = groupID, entryID
	return f.err
}

func groupsHandler(g *fakeGroups) http.Handler {
	return NewHandler(Services{DB: &fakeDB{}, Cards: &fakeCards{}, Auth: &fakeAuth{}, Collection: &fakeCollection{}, CustomGroups: g})
}

// Every group route, with a body where it takes one.
var groupRoutes = []struct{ method, path, body, call string }{
	{http.MethodGet, "/api/groups", "", "list"},
	{http.MethodPost, "/api/groups", `{"name":"Binder","kind":"binder","description":""}`, "create"},
	{http.MethodGet, "/api/groups/4", "", "group"},
	{http.MethodPatch, "/api/groups/4", `{"name":"Deck"}`, "change"},
	{http.MethodDelete, "/api/groups/4", "", "delete"},
	{http.MethodGet, "/api/groups/4/groups?group_by=color", "", "groups"},
	{http.MethodGet, "/api/groups/4/members?group_by=set&key=mh2&sort=added&cursor=abc", "", "members"},
	{http.MethodPut, "/api/groups/4/members/7", `{"quantity":2}`, "set member"},
	{http.MethodDelete, "/api/groups/4/members/7", "", "remove member"},
}

func TestGroupsNeedASignedInUser(t *testing.T) {
	for _, r := range groupRoutes {
		g := &fakeGroups{}
		rec := send(t, groupsHandler(g), r.method, r.path, r.body)
		if rec.Code != http.StatusUnauthorized || len(g.calls) != 0 {
			t.Errorf("%s %s without a session = %d, calls %v; want 401", r.method, r.path, rec.Code, g.calls)
		}
	}
}

func TestEachGroupRouteReachesItsHandlerForTheSignedInUser(t *testing.T) {
	for _, r := range groupRoutes {
		g := &fakeGroups{}
		rec := send(t, groupsHandler(g), r.method, r.path, r.body, signedIn...)
		if rec.Code >= 300 || len(g.calls) != 1 || g.calls[0] != r.call || g.userID != testUser.ID {
			t.Errorf("%s %s = %d %s, calls %v for user %d; want %s for %d", r.method, r.path, rec.Code, rec.Body, g.calls, g.userID, r.call, testUser.ID)
		}
		if r.path != "/api/groups" && g.groupID != 4 {
			t.Errorf("%s %s: group %d, want 4", r.method, r.path, g.groupID)
		}
	}
}

func TestGroupRoutesPassTheirParametersOn(t *testing.T) {
	g := &fakeGroups{}
	send(t, groupsHandler(g), http.MethodPost, "/api/groups", `{"name":"Trade","kind":"binder","description":"LGS"}`, signedIn...)
	if want := (contract.NewGroup{Name: "Trade", Kind: "binder", Description: "LGS"}); g.newGroup != want {
		t.Errorf("new group = %+v", g.newGroup)
	}
	send(t, groupsHandler(g), http.MethodPatch, "/api/groups/4", `{"kind":"deck"}`, signedIn...)
	if g.change.Kind == nil || *g.change.Kind != "deck" || g.change.Name != nil || g.change.Description != nil {
		t.Errorf("change = %+v", g.change)
	}
	send(t, groupsHandler(g), http.MethodGet, "/api/groups/4/groups?group_by=color", "", signedIn...)
	if g.groupBy != "color" {
		t.Errorf("group_by = %q", g.groupBy)
	}
	send(t, groupsHandler(g), http.MethodGet, "/api/groups/4/members?group_by=set&key=mh2&sort=added&cursor=abc", "", signedIn...)
	if want := (collection.EntryQuery{GroupBy: "set", Key: "mh2", Sort: "added", Cursor: "abc"}); g.query != want {
		t.Errorf("query = %+v", g.query)
	}
	send(t, groupsHandler(g), http.MethodPut, "/api/groups/4/members/7", `{"quantity":3}`, signedIn...)
	if g.entryID != 7 || g.quantity != 3 {
		t.Errorf("set member %d to %d", g.entryID, g.quantity)
	}
}

func TestGroupStatuses(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		created            bool
		want               int
	}{
		{http.MethodPost, "/api/groups", `{"name":"B","kind":"box","description":""}`, false, http.StatusCreated},
		{http.MethodPut, "/api/groups/4/members/7", `{"quantity":1}`, true, http.StatusCreated},
		{http.MethodPut, "/api/groups/4/members/7", `{"quantity":1}`, false, http.StatusOK},
		{http.MethodDelete, "/api/groups/4", "", false, http.StatusNoContent},
		{http.MethodDelete, "/api/groups/4/members/7", "", false, http.StatusNoContent},
	} {
		rec := send(t, groupsHandler(&fakeGroups{created: tc.created}), tc.method, tc.path, tc.body, signedIn...)
		if rec.Code != tc.want {
			t.Errorf("%s %s (created %v) = %d, want %d", tc.method, tc.path, tc.created, rec.Code, tc.want)
		}
	}
}

func TestIDsThatCantBeOnesAre404s(t *testing.T) {
	for _, tc := range []struct{ method, path, msg string }{
		{http.MethodGet, "/api/groups/abc", "no such group"},
		{http.MethodGet, "/api/groups/0", "no such group"},
		{http.MethodPatch, "/api/groups/-2", "no such group"},
		{http.MethodGet, "/api/groups/x/members", "no such group"},
		{http.MethodPut, "/api/groups/x/members/7", "no such group"},
		{http.MethodPut, "/api/groups/4/members/0", "no such entry"},
		{http.MethodDelete, "/api/groups/4/members/seven", "no such entry"},
	} {
		g := &fakeGroups{}
		rec := send(t, groupsHandler(g), tc.method, tc.path, `{"quantity":1,"name":"x"}`, signedIn...)
		if rec.Code != http.StatusNotFound || assertJSONError(t, rec.Body.String()) != tc.msg || len(g.calls) != 0 {
			t.Errorf("%s %s = %d %s, calls %v; want 404 %q", tc.method, tc.path, rec.Code, rec.Body, g.calls, tc.msg)
		}
	}
}

func TestGroupErrorsGetTheirStatus(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
	}{
		{apperr.New(apperr.Invalid, "give the group a name"), 400},
		{collection.ErrGroupNotFound, 404},
		{collection.ErrMemberNotFound, 404},
		{apperr.New(apperr.Conflict, "you already have a group called \"B\""), 409},
		{errors.New("ERROR: secret"), 500},
	} {
		for _, r := range groupRoutes {
			rec := send(t, groupsHandler(&fakeGroups{err: tc.err}), r.method, r.path, r.body, signedIn...)
			if rec.Code != tc.status {
				t.Errorf("%v, %s %s = %d, want %d", tc.err, r.method, r.path, rec.Code, tc.status)
			}
			assertJSONError(t, rec.Body.String())
		}
	}
}

func TestBadGroupBodiesAreRefused(t *testing.T) {
	for _, tc := range []struct{ method, path, body, msg string }{
		{http.MethodPost, "/api/groups", `{"name":"B","kind":"cube","description":""}`, "kind must be one of binder, deck, box, other"},
		{http.MethodPatch, "/api/groups/4", `{"kind":"cube"}`, "kind must be one of binder, deck, box, other"},
		{http.MethodPost, "/api/groups", `{"name":"B","kind":"box","owner":2}`, "the body isn't the JSON this endpoint takes"},
		{http.MethodPut, "/api/groups/4/members/7", `{"quantity":"2"}`, "quantity has the wrong type"},
	} {
		g := &fakeGroups{}
		rec := send(t, groupsHandler(g), tc.method, tc.path, tc.body, signedIn...)
		if rec.Code != http.StatusBadRequest || assertJSONError(t, rec.Body.String()) != tc.msg || len(g.calls) != 0 {
			t.Errorf("%s %s %s = %d %s; want 400 %q", tc.method, tc.path, tc.body, rec.Code, rec.Body, tc.msg)
		}
	}
}

func TestCrossOriginGroupChangesAreRefused(t *testing.T) {
	for _, r := range groupRoutes {
		if r.method == http.MethodGet {
			continue
		}
		g := &fakeGroups{}
		rec := send(t, groupsHandler(g), r.method, r.path, r.body, append([]string{"Sec-Fetch-Site", "cross-site"}, signedIn...)...)
		if rec.Code != http.StatusForbidden || len(g.calls) != 0 {
			t.Errorf("%s %s from another site = %d, calls %v; want 403", r.method, r.path, rec.Code, g.calls)
		}
	}
}
