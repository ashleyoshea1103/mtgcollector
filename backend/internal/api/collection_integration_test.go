//go:build integration

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/auth"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/collection"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// A Lightning Bolt printing the live servers' databases have.
const bolt = "0b8fe8b3-0000-4000-8000-000000000001"

// liveServer serves the API from the real services, over TLS (the session cookie is Secure),
// with one card in its database. newBrowser signs a new user up in a browser of their own.
func liveServer(t *testing.T) (srv *httptest.Server, newBrowser func(email string) browser) {
	t.Helper()
	pool := testdb.New(t)
	owned := &collection.Service{Pool: pool}
	srv = httptest.NewTLSServer(NewHandler(Services{
		DB: pool, Auth: auth.NewService(store.New(pool)), Collection: owned, CustomGroups: owned,
	}))
	t.Cleanup(srv.Close)
	for _, sql := range []string{
		`INSERT INTO sets (code, scryfall_id, name, set_type, released_at) VALUES ('m10', gen_random_uuid(), 'Magic 2010', 'core', '2009-07-17')`,
		`INSERT INTO cards (id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc, type_line,
		                    colors, color_identity, finishes, price_eur, price_eur_foil, released_at)
		 VALUES ('` + bolt + `', gen_random_uuid(), 'Lightning Bolt', 'en', 'm10', '146', 'common', 'normal', '{R}', 1, 'Instant',
		         '{R}', '{R}', '{nonfoil,foil}', 1.50, 6.00, '2009-07-17')`,
	} {
		if _, err := pool.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	return srv, func(email string) browser {
		jar, _ := cookiejar.New(nil)
		b := browser{&http.Client{Transport: srv.Client().Transport, Jar: jar}}
		b.do(t, srv.URL, "POST", "/api/auth/signup", `{"email":"`+email+`","password":"correct horse battery staple"}`, 201, nil)
		return b
	}
}

// Two browsers, through the real services and database: each sees and changes only its own
// collection.
func TestTwoUsersCollectionsAgainstARealDatabase(t *testing.T) {
	srv, newBrowser := liveServer(t)
	ann, bob := newBrowser("ann@example.com"), newBrowser("bob@example.com")

	var added contract.CollectionEntry
	ann.do(t, srv.URL, "POST", "/api/collection/entries",
		`{"card_id":"`+bolt+`","quantity":4,"finish":"foil","condition":"NM","language":"en","group_id":null}`, 201, &added)
	if added.Card.Name != "Lightning Bolt" || added.Quantity != 4 || added.ValueEUR == nil || *added.ValueEUR != 24 {
		t.Errorf("added %+v", added)
	}
	ann.do(t, srv.URL, "POST", "/api/collection/entries",
		`{"card_id":"`+bolt+`","quantity":1,"finish":"foil","condition":"NM","language":"en","group_id":null}`, 200, &added)
	if added.Quantity != 5 {
		t.Errorf("after adding one more: %d copies, want 5", added.Quantity)
	}
	id := jsonID(added.ID)

	var groups contract.CollectionGroups
	ann.do(t, srv.URL, "GET", "/api/collection/groups?group_by=color", "", 200, &groups)
	if len(groups.Groups) != 1 || groups.Groups[0].Key != "R" || groups.Groups[0].CardCount != 5 || groups.Groups[0].ValueEUR != 30 {
		t.Errorf("Ann's groups = %+v", groups)
	}
	var page contract.EntryPage
	ann.do(t, srv.URL, "GET", "/api/collection/entries?group_by=color&key=R&sort=price", "", 200, &page)
	if len(page.Entries) != 1 || page.NextCursor != nil {
		t.Errorf("Ann's entries = %+v", page)
	}

	// Bob sees nothing of Ann's, and can't change it.
	bob.do(t, srv.URL, "GET", "/api/collection/groups?group_by=color", "", 200, &groups)
	if len(groups.Groups) != 0 {
		t.Errorf("Bob sees groups %+v", groups.Groups)
	}
	var stats contract.CollectionStats
	bob.do(t, srv.URL, "GET", "/api/collection/stats", "", 200, &stats)
	if stats.CardCount != 0 {
		t.Errorf("Bob's stats = %+v", stats)
	}
	bob.do(t, srv.URL, "PATCH", "/api/collection/entries/"+id, `{"quantity":1}`, 404, nil)
	bob.do(t, srv.URL, "DELETE", "/api/collection/entries/"+id, "", 404, nil)

	ann.do(t, srv.URL, "PATCH", "/api/collection/entries/"+id, `{"quantity":2,"condition":"LP"}`, 200, &added)
	if added.Quantity != 2 || added.Condition != "LP" {
		t.Errorf("after the change: %+v", added)
	}
	ann.do(t, srv.URL, "PATCH", "/api/collection/entries/"+id, `{"finish":"etched"}`, 400, nil)
	ann.do(t, srv.URL, "DELETE", "/api/collection/entries/"+id, "", 204, nil)
	ann.do(t, srv.URL, "GET", "/api/collection/stats", "", 200, &stats)
	if stats.CardCount != 0 {
		t.Errorf("Ann's stats after deleting = %+v", stats)
	}
}

// A search through the real handlers and database: it narrows the collection's and a group's
// listings, and one the database couldn't run is a 400, never a 500.
func TestSearchingAgainstARealDatabase(t *testing.T) {
	srv, newBrowser := liveServer(t)
	ann := newBrowser("ann@example.com")
	var added contract.CollectionEntry
	ann.do(t, srv.URL, "POST", "/api/collection/entries",
		`{"card_id":"`+bolt+`","quantity":2,"finish":"nonfoil","condition":"NM","language":"en","group_id":null}`, 201, &added)
	var group contract.CustomGroup
	ann.do(t, srv.URL, "POST", "/api/groups", `{"name":"Burn","kind":"deck","description":""}`, 201, &group)
	ann.do(t, srv.URL, "PUT", "/api/groups/"+jsonID(group.ID)+"/members/"+jsonID(added.ID), `{"quantity":1}`, 201, nil)
	groupPath := "/api/groups/" + jsonID(group.ID)

	for _, path := range []string{"/api/collection", groupPath} {
		var groups contract.CollectionGroups
		ann.do(t, srv.URL, "GET", path+"/groups?group_by=color&q=bolt+instant", "", 200, &groups)
		if len(groups.Groups) != 1 || groups.Groups[0].Key != "R" {
			t.Errorf("%s groups for bolt = %+v", path, groups.Groups)
		}
		ann.do(t, srv.URL, "GET", path+"/groups?group_by=color&q=goblin", "", 200, &groups)
		if len(groups.Groups) != 0 {
			t.Errorf("%s groups for goblin = %+v", path, groups.Groups)
		}
	}
	var page contract.EntryPage
	ann.do(t, srv.URL, "GET", "/api/collection/entries?q=LIGHTNING", "", 200, &page)
	if len(page.Entries) != 1 {
		t.Errorf("entries for LIGHTNING = %+v", page.Entries)
	}
	var members contract.GroupMemberPage
	ann.do(t, srv.URL, "GET", groupPath+"/members?q=goblin", "", 200, &members)
	if len(members.Members) != 0 {
		t.Errorf("members for goblin = %+v", members.Members)
	}

	for name, q := range map[string]string{"too long": strings.Repeat("a", contract.MaxSearchLength+1), "a NUL": "bolt%00", "not UTF-8": "bolt%FF"} {
		for _, path := range []string{"/api/collection/groups", "/api/collection/entries", groupPath + "/groups", groupPath + "/members"} {
			t.Run(name+" "+path, func(t *testing.T) { ann.do(t, srv.URL, "GET", path+"?q="+q, "", 400, nil) })
		}
	}
}

func jsonID(id int64) string { b, _ := json.Marshal(id); return string(b) }

// browser is a client with its own cookies: one signed-in user.
type browser struct{ client *http.Client }

// do makes a same-origin request, checks its status, and reads the JSON reply into out.
func (b browser) do(t *testing.T, base, method, path, body string, status int, out any) {
	t.Helper()
	req, _ := http.NewRequest(method, base+path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, err := b.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	got, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("%s %s = %d %s, want %d", method, path, res.StatusCode, got, status)
	}
	if out != nil {
		if err := json.Unmarshal(got, out); err != nil {
			t.Fatalf("%s %s: %v in %s", method, path, err, got)
		}
	}
}
