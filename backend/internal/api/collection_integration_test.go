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

// Two browsers, through the real services and database: each sees and changes only its own
// collection.
func TestTwoUsersCollectionsAgainstARealDatabase(t *testing.T) {
	pool := testdb.New(t)
	q := store.New(pool)
	srv := httptest.NewTLSServer(NewHandler(Services{
		DB: pool, Auth: auth.NewService(q), Collection: &collection.Service{Q: q},
	}))
	t.Cleanup(srv.Close)
	const bolt = "0b8fe8b3-0000-4000-8000-000000000001"
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

	newBrowser := func(email string) browser {
		c := srv.Client()
		jar, _ := cookiejar.New(nil)
		c = &http.Client{Transport: c.Transport, Jar: jar}
		b := browser{c}
		b.do(t, srv.URL, "POST", "/api/auth/signup", `{"email":"`+email+`","password":"correct horse battery staple"}`, 201, nil)
		return b
	}
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
