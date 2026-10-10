//go:build integration

package collection

import (
	"errors"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

func (f *fixture) group(t *testing.T, user int64, name string) contract.CustomGroup {
	t.Helper()
	g, err := f.s.CreateGroup(t.Context(), user, contract.NewGroup{Name: name, Kind: contract.CustomGroupKindBinder})
	if err != nil {
		t.Fatalf("create group %q: %v", name, err)
	}
	return g
}

func (f *fixture) member(t *testing.T, user, group, entry int64, quantity int) contract.GroupMember {
	t.Helper()
	m, _, err := f.s.SetMember(t.Context(), user, group, entry, quantity)
	if err != nil {
		t.Fatalf("set member: %v", err)
	}
	return m
}

func TestCreatingAGroup(t *testing.T) {
	f := newFixture(t)
	g, err := f.s.CreateGroup(t.Context(), f.ann, contract.NewGroup{
		Name: "  Trade binder ", Kind: contract.CustomGroupKindBinder, Description: "For the LGS.\nRares only.",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := contract.CustomGroup{
		ID: g.ID, Name: "Trade binder", Kind: contract.CustomGroupKindBinder, Description: "For the LGS.\nRares only.",
		PreviewImages: []string{},
	}
	if !equalGroup(g, want) {
		t.Errorf("= %+v, want %+v", g, want)
	}
	again, err := f.s.Group(t.Context(), f.ann, g.ID)
	if err != nil || !equalGroup(again, want) {
		t.Errorf("Group = %+v, %v", again, err)
	}
	if _, err := f.s.Group(t.Context(), f.bob, g.ID); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob reading Ann's group = %v, want ErrGroupNotFound", err)
	}
}

func equalGroup(a, b contract.CustomGroup) bool {
	return a.ID == b.ID && a.Name == b.Name && a.Kind == b.Kind && a.Description == b.Description &&
		a.ValueTotal == b.ValueTotal && slices.Equal(a.PreviewImages, b.PreviewImages) && a.PreviewImages != nil
}

func TestGroupsTheServerRefuses(t *testing.T) {
	f := newFixture(t)
	f.group(t, f.ann, "Trade binder")
	for name, g := range map[string]contract.NewGroup{
		"no name":                  {Name: "", Kind: "deck"},
		"a blank name":             {Name: "   ", Kind: "deck"},
		"a name too long":          {Name: strings.Repeat("x", contract.MaxGroupNameLength+1), Kind: "deck"},
		"a NUL in the name":        {Name: "Bin\x00der", Kind: "deck"},
		"a line break in the name": {Name: "Bin\nder", Kind: "deck"},
		"invalid UTF-8":            {Name: "Bin\xffder", Kind: "deck"},
		"no kind":                  {Name: "Deck"},
		"an unknown kind":          {Name: "Deck", Kind: "cube"},
		"a description too long":   {Name: "Deck", Kind: "deck", Description: strings.Repeat("x", contract.MaxGroupDescriptionLength+1)},
		"a NUL in the description": {Name: "Deck", Kind: "deck", Description: "a\x00b"},
	} {
		if _, err := f.s.CreateGroup(t.Context(), f.ann, g); !isInputError(err) {
			t.Errorf("%s: = %v, want an apperr.Invalid", name, err)
		}
	}
	// The longest name and description are fine, counted in characters.
	if _, err := f.s.CreateGroup(t.Context(), f.ann, contract.NewGroup{
		Name: strings.Repeat("é", contract.MaxGroupNameLength), Kind: "box", Description: strings.Repeat("ü", contract.MaxGroupDescriptionLength),
	}); err != nil {
		t.Errorf("the longest name and description: %v", err)
	}
	// A name the user has, in any case, is a conflict; another user can have it.
	_, err := f.s.CreateGroup(t.Context(), f.ann, contract.NewGroup{Name: "TRADE BINDER", Kind: "box"})
	if apperr.KindOf(err) != apperr.Conflict || !strings.Contains(err.Error(), "TRADE BINDER") {
		t.Errorf("a name Ann has, in capitals = %v, want a conflict", err)
	}
	f.group(t, f.bob, "Trade binder")
}

func TestAUserHasAtMostMaxGroups(t *testing.T) {
	f := newFixture(t)
	f.s.MaxGroups = 2
	f.group(t, f.ann, "One")
	f.group(t, f.ann, "Two")
	if _, err := f.s.CreateGroup(t.Context(), f.ann, contract.NewGroup{Name: "Three", Kind: "box"}); !isInputError(err) {
		t.Errorf("a third group = %v, want the limit", err)
	}
	f.group(t, f.bob, "Bob's first")
	if (&Service{Pool: f.pool}).maxGroups() != contract.MaxGroups {
		t.Error("the default limit isn't contract.MaxGroups")
	}
}

func TestListingGroups(t *testing.T) {
	f := newFixture(t)
	for _, name := range []string{"zebra deck", "Æther binder", "aether box", "Bulk"} {
		f.group(t, f.ann, name)
	}
	f.group(t, f.bob, "Bob's")
	list, err := f.s.ListGroups(t.Context(), f.ann)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, g := range list.Groups {
		names = append(names, g.Name)
	}
	// Unicode order: "Æ" as "ae", and case only breaking ties ("binder" before "box").
	if want := []string{"Æther binder", "aether box", "Bulk", "zebra deck"}; !slices.Equal(names, want) {
		t.Errorf("Ann's groups = %q, want %q (by name, in Unicode order)", names, want)
	}
	empty, err := f.s.ListGroups(t.Context(), f.ann+f.bob+100)
	if err != nil || empty.Groups == nil || len(empty.Groups) != 0 {
		t.Errorf("a user with no groups = %+v, %v; want an empty list", empty, err)
	}
}

func TestChangingAGroup(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	f.group(t, f.ann, "Deck")
	name, deck, desc := "Izzet Tempo", contract.CustomGroupKindDeck, "Modern."
	got, err := f.s.ChangeGroup(t.Context(), f.ann, g.ID, contract.GroupChange{Name: &name, Kind: &deck, Description: &desc})
	if err != nil || got.Name != name || got.Kind != deck || got.Description != desc {
		t.Errorf("change = %+v, %v", got, err)
	}
	only := "Izzet Tempo 2"
	got, _ = f.s.ChangeGroup(t.Context(), f.ann, g.ID, contract.GroupChange{Name: &only})
	if got.Kind != deck || got.Description != desc {
		t.Errorf("changing only the name changed more: %+v", got)
	}
	taken, blank, bad := "deck", " ", contract.CustomGroupKind("cube")
	if _, err := f.s.ChangeGroup(t.Context(), f.ann, g.ID, contract.GroupChange{Name: &taken}); apperr.KindOf(err) != apperr.Conflict {
		t.Errorf("renaming to another group's name = %v, want a conflict", err)
	}
	for name, c := range map[string]contract.GroupChange{"nothing": {}, "a blank name": {Name: &blank}, "an unknown kind": {Kind: &bad}} {
		if _, err := f.s.ChangeGroup(t.Context(), f.ann, g.ID, c); !isInputError(err) {
			t.Errorf("%s: = %v, want an apperr.Invalid", name, err)
		}
	}
	if _, err := f.s.ChangeGroup(t.Context(), f.bob, g.ID, contract.GroupChange{Name: &name}); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob changing Ann's group = %v, want ErrGroupNotFound", err)
	}
}

func TestMembers(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	bolts := f.add(t, f.ann, newEntry(f.card(t, testCard{name: "Bolt", eur: euros(1.5)}), 4))

	m, created, err := f.s.SetMember(t.Context(), f.ann, g.ID, bolts.ID, 3)
	if err != nil || !created || m.Quantity != 3 || m.Entry.ID != bolts.ID || m.Entry.Quantity != 4 ||
		!equalPrice(m.ValueEUR, euros(4.5)) || !equalPrice(m.Entry.ValueEUR, euros(6)) || m.AddedAt == "" {
		t.Errorf("set = %+v, created %v, %v", m, created, err)
	}
	m, created, err = f.s.SetMember(t.Context(), f.ann, g.ID, bolts.ID, 4)
	if err != nil || created || m.Quantity != 4 {
		t.Errorf("setting it again = %+v, created %v, %v; want 4, not new", m, created, err)
	}
	got, _ := f.s.Group(t.Context(), f.ann, g.ID)
	if got.CardCount != 4 || got.ValueEUR != 6 || got.UnpricedCount != 0 {
		t.Errorf("group totals = %+v", got.ValueTotal)
	}

	bobs := f.add(t, f.bob, newEntry(f.card(t, testCard{}), 1))
	bobsGroup := f.group(t, f.bob, "Bob's")
	for name, tc := range map[string]struct {
		group, entry int64
		quantity     int
		want         error // or nil for an apperr.Invalid
	}{
		"more copies than the entry has": {g.ID, bolts.ID, 5, nil},
		"no copies":                      {g.ID, bolts.ID, 0, nil},
		"Bob's entry in Ann's group":     {g.ID, bobs.ID, 1, ErrNotFound},
		"Ann's entry in Bob's group":     {bobsGroup.ID, bolts.ID, 1, ErrGroupNotFound},
		"no such entry":                  {g.ID, 999999, 1, ErrNotFound},
		"no such group":                  {999999, bolts.ID, 1, ErrGroupNotFound},
	} {
		_, _, err := f.s.SetMember(t.Context(), f.ann, tc.group, tc.entry, tc.quantity)
		if tc.want == nil && !isInputError(err) || tc.want != nil && !errors.Is(err, tc.want) {
			t.Errorf("%s: = %v, want %v", name, err, cmpOrErr(tc.want))
		}
	}
	if _, _, err := f.s.SetMember(t.Context(), f.ann, g.ID, bolts.ID, 5); err == nil || !strings.Contains(err.Error(), "has 4 copies") {
		t.Errorf("too many copies: %v, want it to say how many there are", err)
	}
}

func cmpOrErr(err error) any {
	if err == nil {
		return "an apperr.Invalid"
	}
	return err
}

// A member never holds more copies than its entry: lowering the entry lowers its members.
func TestLoweringAnEntryLowersItsMembers(t *testing.T) {
	f := newFixture(t)
	binder, deck := f.group(t, f.ann, "Binder"), f.group(t, f.ann, "Deck")
	e := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 4))
	f.member(t, f.ann, binder.ID, e.ID, 4)
	f.member(t, f.ann, deck.ID, e.ID, 1)
	two := 2
	if _, err := f.s.Change(t.Context(), f.ann, e.ID, contract.EntryChange{Quantity: &two}); err != nil {
		t.Fatal(err)
	}
	if m, _ := f.s.member(t.Context(), f.ann, binder.ID, e.ID); m.Quantity != 2 {
		t.Errorf("binder holds %d after the entry went down to 2", m.Quantity)
	}
	if m, _ := f.s.member(t.Context(), f.ann, deck.ID, e.ID); m.Quantity != 1 {
		t.Errorf("deck holds %d, want its 1 untouched", m.Quantity)
	}
	// Even written straight to the table, a member can't hold more than its entry.
	if _, err := f.pool.Exec(t.Context(), `UPDATE group_members SET quantity = 50 WHERE group_id = $1`, deck.ID); err != nil {
		t.Fatal(err)
	}
	if m, _ := f.s.member(t.Context(), f.ann, deck.ID, e.ID); m.Quantity != 2 {
		t.Errorf("deck holds %d after asking for 50 of 2", m.Quantity)
	}
}

// The table won't hold a member whose group and entry are different users'.
func TestAMembersGroupAndEntryAreOneUsers(t *testing.T) {
	f := newFixture(t)
	annsGroup := f.group(t, f.ann, "Ann's")
	bobs := f.add(t, f.bob, newEntry(f.card(t, testCard{}), 1))
	for _, user := range []int64{f.ann, f.bob} {
		if _, err := f.pool.Exec(t.Context(),
			`INSERT INTO group_members (group_id, entry_id, user_id, quantity) VALUES ($1, $2, $3, 1)`,
			annsGroup.ID, bobs.ID, user); err == nil {
			t.Errorf("Bob's entry went in Ann's group (as user %d)", user)
		}
	}
}

func TestRemovingAndDeleting(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	keep, gone := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1)), f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1))
	f.member(t, f.ann, g.ID, keep.ID, 1)
	f.member(t, f.ann, g.ID, gone.ID, 1)

	if err := f.s.RemoveMember(t.Context(), f.bob, g.ID, keep.ID); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob removing from Ann's group = %v, want ErrGroupNotFound", err)
	}
	if err := f.s.RemoveMember(t.Context(), f.ann, g.ID, keep.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.s.RemoveMember(t.Context(), f.ann, g.ID, keep.ID); !errors.Is(err, ErrMemberNotFound) {
		t.Errorf("removing it again = %v, want ErrMemberNotFound", err)
	}
	if _, err := f.s.get(t.Context(), f.ann, keep.ID); err != nil {
		t.Errorf("the removed entry left the collection: %v", err)
	}
	// Deleting an entry takes it out of its groups.
	if err := f.s.Delete(t.Context(), f.ann, gone.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := f.s.Group(t.Context(), f.ann, g.ID); got.CardCount != 0 {
		t.Errorf("group holds %d cards after its entry was deleted", got.CardCount)
	}
	// Deleting a group leaves its cards in the collection.
	f.member(t, f.ann, g.ID, keep.ID, 1)
	if err := f.s.DeleteGroup(t.Context(), f.bob, g.ID); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob deleting Ann's group = %v, want ErrGroupNotFound", err)
	}
	if err := f.s.DeleteGroup(t.Context(), f.ann, g.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.Group(t.Context(), f.ann, g.ID); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("the deleted group = %v", err)
	}
	if _, err := f.s.get(t.Context(), f.ann, keep.ID); err != nil {
		t.Errorf("deleting the group deleted its entry: %v", err)
	}
	var members int
	f.pool.QueryRow(t.Context(), `SELECT count(*) FROM group_members WHERE group_id = $1`, g.ID).Scan(&members)
	if members != 0 {
		t.Errorf("%d members outlived their group", members)
	}
}

func TestAddingCardsStraightToAGroup(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	card := f.card(t, testCard{eur: euros(2)})
	e := newEntry(card, 3)
	e.GroupID = &g.ID
	entry, created, err := f.s.Add(t.Context(), f.ann, e)
	if err != nil || !created || entry.Quantity != 3 {
		t.Fatalf("add = %+v, %v, %v", entry, created, err)
	}
	if m, _ := f.s.member(t.Context(), f.ann, g.ID, entry.ID); m.Quantity != 3 {
		t.Errorf("the group holds %d, want the 3 added", m.Quantity)
	}
	e.Quantity = 2
	f.s.Add(t.Context(), f.ann, e)
	if m, _ := f.s.member(t.Context(), f.ann, g.ID, entry.ID); m.Quantity != 5 {
		t.Errorf("the group holds %d after 2 more, want 5", m.Quantity)
	}
	// Copies added without the group don't go in it.
	plain := newEntry(card, 1)
	f.s.Add(t.Context(), f.ann, plain)
	if m, _ := f.s.member(t.Context(), f.ann, g.ID, entry.ID); m.Quantity != 5 {
		t.Errorf("the group holds %d after one added without it, want 5", m.Quantity)
	}

	// A group that isn't the user's: nothing is added at all.
	bobsGroup := f.group(t, f.bob, "Bob's")
	other := newEntry(f.card(t, testCard{}), 1)
	other.GroupID = &bobsGroup.ID
	if _, _, err := f.s.Add(t.Context(), f.ann, other); !isInputError(err) {
		t.Errorf("adding to Bob's group = %v, want an apperr.Invalid", err)
	}
	if page, _ := f.s.Entries(t.Context(), f.ann, EntryQuery{}); len(page.Entries) != 1 {
		t.Errorf("Ann has %d entries after the refused add, want 1", len(page.Entries))
	}
	// Nor when the entry can't be added (here, a finish the card hasn't).
	bad := newEntry(card, 1)
	bad.Finish, bad.GroupID = contract.FinishEtched, &g.ID
	if _, _, err := f.s.Add(t.Context(), f.ann, bad); !isInputError(err) {
		t.Errorf("adding an etched copy = %v, want an apperr.Invalid", err)
	}
}

func TestAGroupsCardsAreGroupedAndPagedLikeTheCollection(t *testing.T) {
	f := newFixture(t)
	f.collection(t) // Ann's cards
	g := f.group(t, f.ann, "Deck")
	page, _ := f.s.Entries(t.Context(), f.ann, EntryQuery{})
	// One copy of each of Ann's entries, except the first, which isn't in the deck.
	for _, e := range page.Entries[1:] {
		f.member(t, f.ann, g.ID, e.ID, 1)
	}
	inDeck := len(page.Entries) - 1

	groups, err := f.s.GroupGroups(t.Context(), f.ann, g.ID, contract.GroupByNone)
	if err != nil || len(groups.Groups) != 1 || groups.Groups[0].CardCount != inDeck || groups.Groups[0].EntryCount != inDeck {
		t.Errorf("the deck's one group = %+v, %v; want %d cards (one copy of each)", groups, err, inDeck)
	}
	byColor, _ := f.s.GroupGroups(t.Context(), f.ann, g.ID, contract.GroupByColor)
	total := 0
	for _, gr := range byColor.Groups {
		total += gr.CardCount
	}
	if total != inDeck {
		t.Errorf("the deck's colour groups hold %d cards, want %d", total, inDeck)
	}

	var members []contract.GroupMember
	q := EntryQuery{Sort: contract.SortByPrice}
	for {
		p, err := f.s.Members(t.Context(), f.ann, g.ID, q)
		if err != nil {
			t.Fatal(err)
		}
		members = append(members, p.Members...)
		if p.NextCursor == nil {
			break
		}
		q.Cursor = *p.NextCursor
	}
	if len(members) != inDeck {
		t.Fatalf("%d members, want %d", len(members), inDeck)
	}
	for _, m := range members {
		if m.Quantity != 1 || m.Entry.ID == page.Entries[0].ID {
			t.Errorf("member %+v", m)
		}
	}

	// Nobody else's group, and no cursor from another listing.
	if _, err := f.s.Members(t.Context(), f.bob, g.ID, EntryQuery{}); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob listing Ann's group = %v", err)
	}
	if _, err := f.s.GroupGroups(t.Context(), f.bob, g.ID, contract.GroupByNone); !errors.Is(err, ErrGroupNotFound) {
		t.Errorf("Bob grouping Ann's group = %v", err)
	}
}

// Cursors are for one listing: the collection's, or one group's.
func TestACursorIsForOneGroup(t *testing.T) {
	f := newFixture(t)
	a, b := f.group(t, f.ann, "A"), f.group(t, f.ann, "B")
	for range PageSize + 1 {
		e := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1))
		f.member(t, f.ann, a.ID, e.ID, 1)
		f.member(t, f.ann, b.ID, e.ID, 1)
	}
	first, err := f.s.Members(t.Context(), f.ann, a.ID, EntryQuery{})
	if err != nil || first.NextCursor == nil {
		t.Fatalf("A's first page: %v", err)
	}
	if _, err := f.s.Members(t.Context(), f.ann, b.ID, EntryQuery{Cursor: *first.NextCursor}); !isInputError(err) {
		t.Errorf("A's cursor on B = %v, want an apperr.Invalid", err)
	}
	if _, err := f.s.Entries(t.Context(), f.ann, EntryQuery{Cursor: *first.NextCursor}); !isInputError(err) {
		t.Errorf("A's cursor on the collection = %v, want an apperr.Invalid", err)
	}
	coll, _ := f.s.Entries(t.Context(), f.ann, EntryQuery{})
	if _, err := f.s.Members(t.Context(), f.ann, a.ID, EntryQuery{Cursor: *coll.NextCursor}); !isInputError(err) {
		t.Errorf("the collection's cursor on A = %v, want an apperr.Invalid", err)
	}
}

// Newest first, in a group, is by when cards joined the group.
func TestAGroupsNewestAreTheLastToJoinIt(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	older := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1))
	newer := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1))
	f.member(t, f.ann, g.ID, newer.ID, 1)
	time.Sleep(2 * time.Millisecond)
	f.member(t, f.ann, g.ID, older.ID, 1)
	p, err := f.s.Members(t.Context(), f.ann, g.ID, EntryQuery{Sort: contract.SortByAdded})
	if err != nil || len(p.Members) != 2 || p.Members[0].Entry.ID != older.ID {
		t.Errorf("newest first = %+v, %v; want the entry that joined last first", p.Members, err)
	}
	if p.Members[0].AddedAt <= p.Members[1].AddedAt {
		t.Errorf("added_at %q then %q, want the first newer", p.Members[0].AddedAt, p.Members[1].AddedAt)
	}
}

// A group's preview is its most valuable cards' small images, each card once, four at most.
func TestPreviews(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	var want []string
	for i, price := range []float64{5, 1, 9, 3, 7, 2} {
		c := f.card(t, testCard{eur: euros(price), noImages: i == 4}) // the €7 card has no image
		e := f.add(t, f.ann, newEntry(c, 1))
		f.member(t, f.ann, g.ID, e.ID, 1)
		if price == 9 || price == 5 || price == 3 || price == 2 {
			want = append(want, smallImage(c))
		}
		// The same card again, in foil: still one image.
		foil := newEntry(c, 1)
		foil.Finish = contract.FinishFoil
		e = f.add(t, f.ann, foil)
		f.member(t, f.ann, g.ID, e.ID, 1)
	}
	got, _ := f.s.Group(t.Context(), f.ann, g.ID)
	// By value: 9, 5, 3, then 2 (7 has no image).
	byValue := []string{want[1], want[0], want[2], want[3]} // want is in the order added: 5, 9, 3, 2
	if !slices.Equal(got.PreviewImages, byValue) {
		t.Errorf("previews = %q, want %q", got.PreviewImages, byValue)
	}
	list, _ := f.s.ListGroups(t.Context(), f.ann)
	if !slices.Equal(list.Groups[0].PreviewImages, byValue) {
		t.Errorf("listed previews = %q, want %q", list.Groups[0].PreviewImages, byValue)
	}
}

func TestGroupResultsHaveNoNilListsOrMaps(t *testing.T) {
	f := newFixture(t)
	g := f.group(t, f.ann, "Binder")
	check := func(name string, v any, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if path := nilCollection(reflect.ValueOf(v), name); path != "" {
			t.Errorf("%s is nil", path)
		}
	}
	l, err := f.s.ListGroups(t.Context(), f.ann)
	check("list", l, err)
	one, err := f.s.Group(t.Context(), f.ann, g.ID)
	check("group", one, err)
	gg, err := f.s.GroupGroups(t.Context(), f.ann, g.ID, contract.GroupBySet)
	check("group groups", gg, err)
	m, err := f.s.Members(t.Context(), f.ann, g.ID, EntryQuery{})
	check("members", m, err)
}

// Setting members and changing their entry at the same moment: every call succeeds or is
// refused for a reason (no deadlocks: both lock the entry first), and no member ends up with
// more copies than its entry.
func TestMembersAndTheirEntryChangingAtOnce(t *testing.T) {
	f := newFixture(t)
	binder, deck := f.group(t, f.ann, "Binder"), f.group(t, f.ann, "Deck")
	e := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 10))
	errs := make(chan error, 120)
	var wg sync.WaitGroup
	for i := range 40 {
		wg.Go(func() {
			q := 1 + i%10
			_, err := f.s.Change(t.Context(), f.ann, e.ID, contract.EntryChange{Quantity: &q})
			errs <- err
		})
		for _, g := range []int64{binder.ID, deck.ID} {
			wg.Go(func() {
				_, _, err := f.s.SetMember(t.Context(), f.ann, g, e.ID, 1+(i*7)%10)
				if isInputError(err) { // more than the entry had just then
					err = nil
				}
				errs <- err
			})
		}
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("a call failed: %v", err)
		}
	}
	var over int
	f.pool.QueryRow(t.Context(),
		`SELECT count(*) FROM group_members m JOIN collection_entries e ON e.id = m.entry_id WHERE m.quantity > e.quantity`).Scan(&over)
	if over != 0 {
		t.Errorf("%d members hold more copies than their entry", over)
	}
}
