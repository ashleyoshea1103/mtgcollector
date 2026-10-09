package cards

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

func TestNameWords(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []string
	}{
		{"lightning bolt", []string{"lightning", "bolt"}},
		{"  bolt   lightning ", []string{"bolt", "lightning"}},
		{"a bolt", []string{"bolt"}},                   // one-letter words match everything; dropped
		{"of the bolt", []string{"of", "the", "bolt"}}, // two letters filter, alongside a longer word
		{"", nil},
		{"a b c", nil}, // nothing left: the caller then needs a set
	} {
		got, err := nameWords(tc.in)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("nameWords(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
}

func TestNameWordsNeedsOneWordTheIndexCanUse(t *testing.T) {
	// Only two-letter words: a full scan of every card for each search, so refused.
	if _, err := nameWords("of to"); !isQueryError(err) {
		t.Errorf("nameWords(\"of to\") err = %v, want a QueryError", err)
	}
	if _, err := nameWords(strings.Repeat("x", MaxQueryLength+1)); !isQueryError(err) {
		t.Errorf("a too-long name err = %v, want a QueryError", err)
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
}

// Every bad request is refused before any query runs: the Searcher here has no database.
func TestSearchRefusesBadRequests(t *testing.T) {
	s := &Searcher{}
	for name, q := range map[string]Search{
		"no name or set":        {Page: 1},
		"only one-letter words": {Name: "a b", Page: 1},
		"page 0":                {Name: "bolt", Page: 0},
		"a page too far":        {Name: "bolt", Page: MaxPage + 1},
		"a bad set code":        {Set: "mh2'; drop table cards; --", Page: 1},
		"an unknown rarity":     {Name: "bolt", Rarity: "legendary", Page: 1},
		"bad colours":           {Name: "bolt", Colors: "xyz", Page: 1},
		"a too-long type":       {Name: "bolt", Type: strings.Repeat("goblin ", 20), Page: 1},
	} {
		if _, err := s.Search(t.Context(), q); !isQueryError(err) {
			t.Errorf("%s: err = %v, want a QueryError", name, err)
		}
	}
	if _, err := s.Printings(t.Context(), "not-a-uuid", 1); !isQueryError(err) {
		t.Errorf("Printings with a bad id: err = %v, want a QueryError", err)
	}
	if _, err := s.Card(t.Context(), "0b8fe8b3-0000-4000-8000-00000000000"); !isQueryError(err) {
		t.Errorf("Card with a short id: err = %v, want a QueryError", err)
	}
	if _, err := s.Autocomplete(t.Context(), strings.Repeat("x", MaxQueryLength+1)); !isQueryError(err) {
		t.Errorf("Autocomplete with a too-long query: err = %v, want a QueryError", err)
	}
}

func TestAutocompleteWaitsForEnoughCharacters(t *testing.T) {
	s := &Searcher{} // no database: too little typed never reaches it
	for _, typed := range []string{"", "li", "  l i  "} {
		got, err := s.Autocomplete(t.Context(), typed)
		if err != nil || got.Names == nil || len(got.Names) != 0 {
			t.Errorf("Autocomplete(%q) = %#v, %v; want an empty list", typed, got, err)
		}
	}
}

func TestQueryErrorsSayWhatWasWrong(t *testing.T) {
	_, err := (&Searcher{}).Search(t.Context(), Search{Name: "bolt", Rarity: contract.Rarity("legendary"), Page: 1})
	var q *QueryError
	if !errors.As(err, &q) || !strings.Contains(q.Reason, "mythic") {
		t.Errorf("err = %v, want a QueryError listing the rarities", err)
	}
}

func isQueryError(err error) bool {
	var q *QueryError
	return errors.As(err, &q)
}

func TestLongestRun(t *testing.T) {
	for s, want := range map[string]int{"bolt": 4, "---": 0, "ab-c": 2, "Lim-Dûl's": 3, "a1b2c3": 6, "": 0, "%%%": 0} {
		if got := longestRun(s); got != want {
			t.Errorf("longestRun(%q) = %d, want %d", s, got, want)
		}
	}
}

// pg_trgm finds no trigrams without three letters or digits in a row, so such searches
// would scan every card: refused, however long the words are.
func TestSearchNeedsThreeLettersInARow(t *testing.T) {
	s := &Searcher{} // no database: refused before any query
	for _, name := range []string{"---", "''' ---", "ab-c de-f", "%%% ___"} {
		if _, err := s.Search(t.Context(), Search{Name: name, Page: 1}); !isQueryError(err) {
			t.Errorf("Search(%q) err = %v, want a QueryError", name, err)
		}
	}
	// A word without a run of three can still narrow a search led by one with it.
	if words, err := nameWords("ab-c lightning"); err != nil || len(words) != 2 {
		t.Errorf("nameWords = %q, %v", words, err)
	}
	for _, typed := range []string{"'''", "l-i-g", "ab cd"} {
		got, err := s.Autocomplete(t.Context(), typed)
		if err != nil || len(got.Names) != 0 {
			t.Errorf("Autocomplete(%q) = %q, %v; want nothing, without a query", typed, got.Names, err)
		}
	}
}

func TestTheLastPageNeverSaysThereIsMore(t *testing.T) {
	full := make([]store.CardListing, PageSize+1) // one more than a page: there is more
	if p, err := page(full, 1); err != nil || !p.HasMore || len(p.Cards) != PageSize {
		t.Errorf("page 1: has_more %v, %d cards, %v", p.HasMore, len(p.Cards), err)
	}
	// Page MaxPage+1 would be refused, so the last page doesn't offer it.
	if p, err := page(full, MaxPage); err != nil || p.HasMore {
		t.Errorf("page %d: has_more %v, %v; want false", MaxPage, p.HasMore, err)
	}
}
