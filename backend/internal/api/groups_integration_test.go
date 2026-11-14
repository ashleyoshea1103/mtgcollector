//go:build integration

package api

import (
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// Custom groups through the real services and database: each user sees and changes only
// their own, and a group's cards are entries of the collection.
func TestTwoUsersGroupsAgainstARealDatabase(t *testing.T) {
	srv, newBrowser := liveServer(t)
	ann, bob := newBrowser("ann@example.com"), newBrowser("bob@example.com")

	var g contract.CustomGroup
	ann.do(t, srv.URL, "POST", "/api/groups", `{"name":"Trade binder","kind":"binder","description":""}`, 201, &g)
	gid := jsonID(g.ID)
	ann.do(t, srv.URL, "POST", "/api/groups", `{"name":"trade BINDER","kind":"box","description":""}`, 409, nil)

	// Cards added straight to the group are in the collection and the group.
	var e contract.CollectionEntry
	ann.do(t, srv.URL, "POST", "/api/collection/entries",
		`{"card_id":"`+bolt+`","quantity":4,"finish":"nonfoil","condition":"NM","language":"en","group_id":`+gid+`}`, 201, &e)
	eid := jsonID(e.ID)
	ann.do(t, srv.URL, "GET", "/api/groups/"+gid, "", 200, &g)
	if g.CardCount != 4 || g.ValueEUR != 6 {
		t.Errorf("group after adding = %+v", g.ValueTotal)
	}

	var m contract.GroupMember
	ann.do(t, srv.URL, "PUT", "/api/groups/"+gid+"/members/"+eid, `{"quantity":2}`, 200, &m)
	if m.Quantity != 2 || m.Entry.Quantity != 4 || m.ValueEUR == nil || *m.ValueEUR != 3 {
		t.Errorf("member = %+v", m)
	}
	ann.do(t, srv.URL, "PUT", "/api/groups/"+gid+"/members/"+eid, `{"quantity":5}`, 400, nil)
	var page contract.GroupMemberPage
	ann.do(t, srv.URL, "GET", "/api/groups/"+gid+"/members?sort=price", "", 200, &page)
	if len(page.Members) != 1 || page.Members[0].Quantity != 2 {
		t.Errorf("members = %+v", page)
	}
	var groups contract.CollectionGroups
	ann.do(t, srv.URL, "GET", "/api/groups/"+gid+"/groups?group_by=color", "", 200, &groups)
	if len(groups.Groups) != 1 || groups.Groups[0].Key != "R" || groups.Groups[0].CardCount != 2 {
		t.Errorf("the group's colour groups = %+v", groups)
	}

	// Bob sees none of it, and can't change it.
	var list contract.CustomGroupList
	bob.do(t, srv.URL, "GET", "/api/groups", "", 200, &list)
	if len(list.Groups) != 0 {
		t.Errorf("Bob sees groups %+v", list.Groups)
	}
	for _, r := range []struct{ method, path, body string }{
		{"GET", "/api/groups/" + gid, ""},
		{"PATCH", "/api/groups/" + gid, `{"name":"Mine"}`},
		{"GET", "/api/groups/" + gid + "/members", ""},
		{"GET", "/api/groups/" + gid + "/groups", ""},
		{"PUT", "/api/groups/" + gid + "/members/" + eid, `{"quantity":1}`},
		{"DELETE", "/api/groups/" + gid + "/members/" + eid, ""},
		{"DELETE", "/api/groups/" + gid, ""},
	} {
		bob.do(t, srv.URL, r.method, r.path, r.body, 404, nil)
	}
	// Bob's own group can't take Ann's entry.
	var bobs contract.CustomGroup
	bob.do(t, srv.URL, "POST", "/api/groups", `{"name":"Bob's","kind":"deck","description":""}`, 201, &bobs)
	bob.do(t, srv.URL, "PUT", "/api/groups/"+jsonID(bobs.ID)+"/members/"+eid, `{"quantity":1}`, 404, nil)

	// Deleting the group leaves the cards in the collection.
	ann.do(t, srv.URL, "DELETE", "/api/groups/"+gid, "", 204, nil)
	var stats contract.CollectionStats
	ann.do(t, srv.URL, "GET", "/api/collection/stats", "", 200, &stats)
	if stats.CardCount != 4 {
		t.Errorf("Ann has %d cards after deleting the group, want 4", stats.CardCount)
	}
}
