//go:build integration

package collection

import (
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// every reads every page of a listing.
func (f *fixture) every(t *testing.T, user int64, q EntryQuery) []contract.CollectionEntry {
	t.Helper()
	var all []contract.CollectionEntry
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatalf("%+v: more pages than there are entries", q)
		}
		page, err := f.s.Entries(t.Context(), user, q)
		if err != nil {
			t.Fatalf("%+v: %v", q, err)
		}
		all = append(all, page.Entries...)
		if page.NextCursor == nil {
			return all
		}
		q.Cursor = *page.NextCursor
	}
}

func names(entries []contract.CollectionEntry) []string {
	s := make([]string, len(entries))
	for i, e := range entries {
		s[i] = e.Card.Name
	}
	slices.Sort(s)
	return s
}

var everySort = []contract.SortBy{contract.SortByName, contract.SortByPrice, contract.SortByCMC, contract.SortByAdded}

func TestASearchNarrowsTheEntries(t *testing.T) {
	f := newFixture(t)
	for _, c := range []testCard{
		{name: "Goblin Guide", typeLine: "Creature — Goblin Scout", eur: euros(2)},
		{name: "Lightning Bolt", typeLine: "Instant", eur: euros(1)},
		{name: "Llanowar Elves", typeLine: "Creature — Elf Druid", identity: []string{"G"}, cmc: 1},
		{name: "100% Juice", typeLine: "Instant", cmc: 2},
		{name: "Æther Vial", typeLine: "Artifact", identity: []string{}, cmc: 1, eur: euros(3)},
		{name: "Urza's Saga", typeLine: "Enchantment Land — Urza's Saga", identity: []string{}},
	} {
		f.add(t, f.ann, newEntry(f.card(t, c), 1))
	}
	// Bob's goblin is never in Ann's results.
	f.add(t, f.bob, newEntry(f.card(t, testCard{name: "Goblin King", typeLine: "Creature — Goblin"}), 1))

	all := []string{"100% Juice", "Goblin Guide", "Lightning Bolt", "Llanowar Elves", "Urza's Saga", "Æther Vial"}
	for _, tc := range []struct {
		q    string
		want []string
	}{
		{"", all},
		// As a phone types it.
		{"urza’s", []string{"Urza's Saga"}},
		{"creature - goblin", []string{"Goblin Guide"}},
		// Words that mean something to SQL arrays or to LIKE match only themselves.
		{`{a,b}`, nil},
		{`"`, nil},
		{"NULL", nil},
		{`\`, nil},
		// Many words: each must still be there.
		{strings.Repeat("z ", 75), []string{"Urza's Saga"}},
		{"goblin", []string{"Goblin Guide"}},
		{"GOBLIN", []string{"Goblin Guide"}},
		{"gob", []string{"Goblin Guide"}},
		{"bolt light", []string{"Lightning Bolt"}},
		{"creature", []string{"Goblin Guide", "Llanowar Elves"}},
		// One word from the name and one from the type line, either way round.
		{"llanowar druid", []string{"Llanowar Elves"}},
		{"druid llanowar", []string{"Llanowar Elves"}},
		// Not across the name and the type line: "Guide Creature" isn't a word in either.
		{"guidecreature", nil},
		{"100%", []string{"100% Juice"}},
		{"%", []string{"100% Juice"}},
		{"_", nil},
		{"æther", []string{"Æther Vial"}},
		{"zzz", nil},
	} {
		for _, sort := range everySort {
			got := names(f.every(t, f.ann, EntryQuery{Sort: sort, Search: tc.q}))
			if !slices.Equal(got, tc.want) {
				t.Errorf("search %q by %s = %q, want %q", tc.q, sort, got, tc.want)
			}
		}
	}

	long := strings.Repeat("a", contract.MaxSearchLength+1)
	if _, err := f.s.Entries(t.Context(), f.ann, EntryQuery{Search: long}); !isInputError(err) {
		t.Errorf("an over-long search's entries = %v, want an apperr.Invalid", err)
	}
	if _, err := f.s.Groups(t.Context(), f.ann, contract.GroupByNone, long); !isInputError(err) {
		t.Errorf("an over-long search's groups = %v, want an apperr.Invalid", err)
	}
}

// Every order pages through the matches, and only them, each once.
func TestASearchPagesThroughItsMatchesOnly(t *testing.T) {
	f := newFixture(t)
	var goblins []contract.CollectionEntry
	for i := range PageSize + 1 {
		c := testCard{name: fmt.Sprintf("Card %02d", i%13), typeLine: "Creature — Goblin", cmc: float64(i % 5)}
		if i%4 != 0 {
			c.eur = euros(float64(i%7) + 0.25)
		}
		goblins = append(goblins, f.add(t, f.ann, newEntry(f.card(t, c), 1)))
	}
	for i := range 5 {
		f.add(t, f.ann, newEntry(f.card(t, testCard{name: fmt.Sprintf("Card %02d", i), eur: euros(9)}), 1))
	}
	for _, sort := range everySort {
		q := EntryQuery{Sort: sort, Search: "goblin"}
		first, err := f.s.Entries(t.Context(), f.ann, q)
		if err != nil || len(first.Entries) != PageSize || first.NextCursor == nil {
			t.Fatalf("%s: first page of %d, next %v, %v; want %d and a next page", sort, len(first.Entries), first.NextCursor, err, PageSize)
		}
		got := f.every(t, f.ann, q)
		want := slices.Clone(goblins)
		slices.SortStableFunc(want, order(sort))
		if ids(got) != ids(want) {
			t.Errorf("%s: the pages aren't the goblins in order\n got  %s\n want %s", sort, ids(got), ids(want))
		}
		// The next page's cursor is the search's own.
		q.Cursor, q.Search = *first.NextCursor, "creature"
		if _, err := f.s.Entries(t.Context(), f.ann, q); !isInputError(err) {
			t.Errorf("%s: a cursor used with another search = %v, want an apperr.Invalid", sort, err)
		}
	}
}

func TestASearchNarrowsTheGroups(t *testing.T) {
	f := newFixture(t)
	f.collection(t)
	type group struct {
		key            string
		entries, cards int
		value          float64
		unpriced       int
	}
	for _, tc := range []struct {
		by   contract.GroupBy
		q    string
		want []group
	}{
		// Delver (two entries), Elves (unpriced) and Emrakul; no white, red or multicolour groups.
		{contract.GroupByColor, "creature", []group{{"U", 2, 5, 2.5, 0}, {"G", 1, 3, 0, 3}, {"C", 1, 1, 20, 0}}},
		{contract.GroupByNone, "creature", []group{{"all", 4, 9, 22.5, 3}}},
		{contract.GroupByNone, "zzz", []group{{"all", 0, 0, 0, 0}}},
		// Bob's card is never one of Ann's.
		{contract.GroupByNone, "bob", []group{{"all", 0, 0, 0, 0}}},
		{contract.GroupBySet, "zzz", nil},
	} {
		res, err := f.s.Groups(t.Context(), f.ann, tc.by, tc.q)
		if err != nil {
			t.Fatalf("%s %q: %v", tc.by, tc.q, err)
		}
		var got []group
		for _, g := range res.Groups {
			got = append(got, group{g.Key, g.EntryCount, g.CardCount, g.ValueEUR, g.UnpricedCount})
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s %q:\n got  %v\n want %v", tc.by, tc.q, got, tc.want)
		}
	}
}

// Each group's heading counts exactly the entries its pages list, for the same search: the
// totals query and the pages' queries match entries alike.
func TestASearchsGroupsCountWhatTheirPagesList(t *testing.T) {
	f := newFixture(t)
	f.collection(t)
	for _, by := range []contract.GroupBy{contract.GroupByNone, contract.GroupBySet, contract.GroupByColor, contract.GroupByType, contract.GroupByRarity, contract.GroupByCMC} {
		for _, q := range []string{"creature", "e", "instant bolt"} {
			res, err := f.s.Groups(t.Context(), f.ann, by, q)
			if err != nil {
				t.Fatalf("%s %q: %v", by, q, err)
			}
			for _, g := range res.Groups {
				listed := f.every(t, f.ann, EntryQuery{GroupBy: by, Key: g.Key, Search: q})
				copies := 0
				for _, e := range listed {
					copies += e.Quantity
				}
				if len(listed) != g.EntryCount || copies != g.CardCount {
					t.Errorf("%s %q group %s: heading says %d entries, %d cards; pages list %d, %d", by, q, g.Key, g.EntryCount, g.CardCount, len(listed), copies)
				}
			}
		}
	}
}

func TestASearchNarrowsAGroupsMembers(t *testing.T) {
	f := newFixture(t)
	guide := f.add(t, f.ann, newEntry(f.card(t, testCard{name: "Goblin Guide", typeLine: "Creature — Goblin Scout", eur: euros(2)}), 4))
	bolt := f.add(t, f.ann, newEntry(f.card(t, testCard{name: "Lightning Bolt", typeLine: "Instant"}), 1))
	// A goblin in the collection but not in the group.
	f.add(t, f.ann, newEntry(f.card(t, testCard{name: "Goblin King", typeLine: "Creature — Goblin"}), 1))
	g := f.group(t, f.ann, "Red deck")
	f.member(t, f.ann, g.ID, guide.ID, 3)
	f.member(t, f.ann, g.ID, bolt.ID, 1)

	page, err := f.s.Members(t.Context(), f.ann, g.ID, EntryQuery{Search: "goblin"})
	if err != nil || len(page.Members) != 1 || page.Members[0].Entry.ID != guide.ID {
		t.Errorf("the group's goblins = %+v, %v; want Goblin Guide alone", page.Members, err)
	}
	res, err := f.s.GroupGroups(t.Context(), f.ann, g.ID, contract.GroupByNone, "goblin")
	if err != nil || len(res.Groups) != 1 || res.Groups[0].EntryCount != 1 || res.Groups[0].CardCount != 3 || res.Groups[0].ValueEUR != 6 {
		t.Errorf("the group's goblin totals = %+v, %v; want one entry, its 3 copies in the group, €6", res.Groups, err)
	}
}
