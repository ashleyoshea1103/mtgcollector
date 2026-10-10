package cards

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

func TestLongestRun(t *testing.T) {
	for s, want := range map[string]int{"bolt": 4, "---": 0, "ab-c": 2, "Lim-Dûl's": 3, "a1b2c3": 6, "": 0, "%%%": 0} {
		if got := longestRun(s); got != want {
			t.Errorf("longestRun(%q) = %d, want %d", s, got, want)
		}
	}
}

func TestParseColors(t *testing.T) {
	for _, tc := range []struct {
		in        string
		colors    []string
		colorless bool
	}{
		{"", []string{}, false},
		{"r", []string{"R"}, false},
		{"URu", []string{"U", "R"}, false},
		{" wubrg ", []string{"W", "U", "B", "R", "G"}, false},
		{"c", []string{}, true},
	} {
		colors, colorless, err := parseColors(tc.in)
		if err != nil || !reflect.DeepEqual(colors, tc.colors) || colorless != tc.colorless {
			t.Errorf("parseColors(%q) = %q, %v, %v; want %q, %v", tc.in, colors, colorless, err, tc.colors, tc.colorless)
		}
	}
	for _, bad := range []string{"x", "rc", "CR", "red", "r,g"} {
		if _, _, err := parseColors(bad); !isQueryError(err) {
			t.Errorf("parseColors(%q) err = %v, want a QueryError", bad, err)
		}
	}
}

func TestLikeEscapeMatchesTextLiterally(t *testing.T) {
	if got := likeEscape(`100% b_lt \o/`); got != `100\% b\_lt \\o/` {
		t.Errorf("likeEscape = %q", got)
	}
	if got := containsEach([]string{"a%", "b"}); !reflect.DeepEqual(got, []string{`%a\%%`, "%b%"}) {
		t.Errorf("containsEach = %q", got)
	}
}

// Every bad request is refused before any query runs: the Searcher here has no database.
func TestSearchRefusesBadRequests(t *testing.T) {
	s := &Searcher{}
	for name, q := range map[string]Search{
		"no name or set": {Page: 1},
		// pg_trgm needs three letters or digits in a row; without them the name can't be
		// looked up by index, and every card would be scanned. (With a set, it's fine.)
		"only short words":         {Name: "a of to", Page: 1},
		"only punctuation":         {Name: "--- '''", Page: 1},
		"short runs":               {Name: "ab-c de-f", Page: 1},
		"page 0":                   {Name: "bolt", Page: 0},
		"a page too far":           {Name: "bolt", Page: MaxPage + 1},
		"a bad set code":           {Set: "mh2'; drop table cards; --", Page: 1},
		"an unknown rarity":        {Name: "bolt", Rarity: "legendary", Page: 1},
		"bad colours":              {Name: "bolt", Colors: "xyz", Page: 1},
		"a name longer than any":   {Name: strings.Repeat("x", MaxQueryLength+1), Page: 1},
		"a type longer than any":   {Name: "bolt", Type: strings.Repeat("goblin ", 22), Page: 1},
		"a too-long name in a set": {Set: "mh2", Name: strings.Repeat("x ", MaxQueryLength), Page: 1},
	} {
		if _, err := s.Search(t.Context(), q); !isQueryError(err) {
			t.Errorf("%s: err = %v, want a QueryError", name, err)
		}
	}
	for _, id := range []string{"not-a-uuid", "0b8fe8b3-0000-4000-8000-00000000000", "0b8fe8b3x0000x4000x8000x000000000000", "0b8fe8b300004000800000000000000000"} {
		if _, err := s.Printings(t.Context(), id, 1); !isQueryError(err) {
			t.Errorf("Printings(%q): err = %v, want a QueryError", id, err)
		}
		if _, err := s.Card(t.Context(), id); !isQueryError(err) {
			t.Errorf("Card(%q): err = %v, want a QueryError", id, err)
		}
	}
	if _, err := s.Autocomplete(t.Context(), strings.Repeat("x", MaxQueryLength+1)); !isQueryError(err) {
		t.Errorf("Autocomplete with a too-long query: err = %v, want a QueryError", err)
	}
}

func TestTheLongestCardNameCanBeSearched(t *testing.T) {
	// "Our Market Research Shows That Players Like Really Long Card Names So We Made This
	// Card to Have the Absolute Longest Card Name Ever Elemental": 141 characters.
	if MaxQueryLength < 141 {
		t.Errorf("MaxQueryLength = %d, shorter than a real card's name", MaxQueryLength)
	}
}

func TestParseIDAcceptsScryfallIDs(t *testing.T) {
	for _, id := range []string{"0b8fe8b3-0000-4000-8000-000000000000", "0B8FE8B3-ABCD-4000-8000-00000000000F"} {
		if _, err := ParseID(id); err != nil {
			t.Errorf("ParseID(%q): %v", id, err)
		}
	}
}

func TestAutocompleteWaitsForThreeLettersInARow(t *testing.T) {
	s := &Searcher{} // no database: too little typed never reaches it
	for _, typed := range []string{"", "li", "  l i  ", "'''", "l-i-g", "ab cd"} {
		got, err := s.Autocomplete(t.Context(), typed)
		if err != nil || got.Names == nil || len(got.Names) != 0 {
			t.Errorf("Autocomplete(%q) = %#v, %v; want an empty list", typed, got, err)
		}
	}
}

func TestPagesSayWhetherThereIsMore(t *testing.T) {
	full := make([]store.CardListing, PageSize+1) // one more than a page: there is more
	if p, err := page(full, 1); err != nil || !p.HasMore || len(p.Cards) != PageSize {
		t.Errorf("page 1 of %d+: has_more %v, %d cards, %v", PageSize+1, p.HasMore, len(p.Cards), err)
	}
	exact := make([]store.CardListing, PageSize) // exactly a page: no more
	if p, err := page(exact, 1); err != nil || p.HasMore || len(p.Cards) != PageSize {
		t.Errorf("page 1 of %d: has_more %v, %d cards, %v", PageSize, p.HasMore, len(p.Cards), err)
	}
	// Page MaxPage+1 would be refused, so the last page doesn't offer it.
	if p, err := page(full, MaxPage); err != nil || p.HasMore {
		t.Errorf("page %d: has_more %v, %v; want false", MaxPage, p.HasMore, err)
	}
}

func isQueryError(err error) bool {
	var q *QueryError
	return errors.As(err, &q)
}
