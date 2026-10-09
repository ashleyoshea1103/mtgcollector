//go:build integration

package cards

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"reflect"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// Printings made from the fixture cards to exercise search; their ids are set in searchDB.
var (
	boltM19     = "bolt in m19 (newer, English)"
	boltJA      = "bolt in Japanese (newest)"
	ragavanGone = "a Ragavan printing Scryfall no longer lists"
)

// searchDB imports the six fixture printings (with their real sets) and cards derived from
// them, and returns a Searcher over them and the derived cards' ids.
func searchDB(t *testing.T) (*Searcher, *pgxpool.Pool, map[string]string) {
	t.Helper()
	src := &fakeSource{}
	for _, code := range []string{"m10", "mh2", "isd", "sld", "m19"} {
		b, err := os.ReadFile("testdata/set-" + code + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var s scryfall.Set
		if err := json.Unmarshal(b, &s); err != nil {
			t.Fatal(err)
		}
		src.sets = append(src.sets, s)
	}
	for _, file := range fixtureFiles {
		src.cards = append(src.cards, rawCard(t, file))
	}
	ids := map[string]string{}
	// A copy of a fixture printing with a new id (and, if newCard, a new card), changed by edit.
	derive := func(label, file string, newCard bool, edit func(*scryfall.Card)) {
		c := rawCard(t, file)
		c.ID = randomUUID()
		if newCard {
			c.OracleID = randomUUID()
		}
		edit(&c)
		ids[label] = c.ID
		src.cards = append(src.cards, c)
	}
	derive(boltM19, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt = "m19", "999", "2018-07-13"
	})
	derive(boltJA, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt, c.Lang = "m19", "998", "2020-01-01", "ja"
	})
	derive(ragavanGone, "mh2-138", false, func(c *scryfall.Card) { c.CollectorNumber = "900" })
	// Bolt is an exact match for "bolt"; Boltwave starts with it; Arc Bolt (one printing)
	// has a word starting with it, as Lightning Bolt (three printings) does.
	for _, name := range []string{"Bolt", "Boltwave", "Arc Bolt"} {
		derive(name, "m19-314", true, func(c *scryfall.Card) { c.Name, c.CollectorNumber = name, "b-"+name })
	}
	derive("token", "m19-314", true, func(c *scryfall.Card) {
		tl := "Token Creature — Elf Warrior"
		c.Name, c.Layout, c.TypeLine, c.CollectorNumber = "Elf Warrior", "token", &tl, "t1"
	})
	for i := 1; i <= PageSize+1; i++ {
		derive(fmt.Sprintf("elvish %02d", i), "m19-314", true, func(c *scryfall.Card) {
			c.Name, c.CollectorNumber = fmt.Sprintf("Elvish Pager %02d", i), fmt.Sprintf("e%02d", i)
		})
	}

	pool := testdb.New(t)
	if _, err := newImporter(pool, src).Run(t.Context(), false); err != nil {
		t.Fatalf("import: %v", err)
	}
	if _, err := pool.Exec(t.Context(), "UPDATE cards SET gone_since = now() WHERE id = $1", ids[ragavanGone]); err != nil {
		t.Fatal(err)
	}
	return &Searcher{Q: store.New(pool)}, pool, ids
}

func names(p contract.CardPage) []string {
	out := make([]string, len(p.Cards))
	for i, c := range p.Cards {
		out[i] = c.Name
	}
	return out
}

func search(t *testing.T, s *Searcher, q Search) contract.CardPage {
	t.Helper()
	if q.Page == 0 {
		q.Page = 1
	}
	p, err := s.Search(t.Context(), q)
	if err != nil {
		t.Fatalf("Search(%+v): %v", q, err)
	}
	return p
}

// The API's cards are what the frontend was built against: each fixture printing, imported
// and read back through the API, is the frontend's fixture (prices aside, which change daily).
func TestTheAPIServesCardsShapedLikeTheFrontendFixtures(t *testing.T) {
	s, _, _ := searchDB(t)
	b, err := os.ReadFile("../../../frontend/src/fixtures/cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]map[string]any
	if err := json.Unmarshal(b, &fixtures); err != nil {
		t.Fatal(err)
	}
	for key, file := range fixtureFiles {
		t.Run(key, func(t *testing.T) {
			card, err := s.Card(t.Context(), rawCard(t, file).ID)
			if err != nil {
				t.Fatal(err)
			}
			b, err := json.Marshal(card)
			if err != nil {
				t.Fatal(err)
			}
			var got map[string]any
			if err := json.Unmarshal(b, &got); err != nil {
				t.Fatal(err)
			}
			want := fixtures[key]
			for _, m := range []map[string]any{got, want} {
				if _, ok := m["prices"].(map[string]any); !ok {
					t.Fatalf("no prices object in %v", m)
				}
				delete(m, "prices")
			}
			for _, k := range slices.Sorted(maps.Keys(mergeKeys(got, want))) {
				if !reflect.DeepEqual(stripImageVersions(got[k]), stripImageVersions(want[k])) {
					t.Errorf("%s:\n got  %v\n want %v", k, got[k], want[k])
				}
			}
		})
	}
}

func mergeKeys(a, b map[string]any) map[string]bool {
	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}
	for k := range b {
		keys[k] = true
	}
	return keys
}

func TestSearchFindsCardsByAnyOrderOfWords(t *testing.T) {
	s, _, _ := searchDB(t)
	for _, q := range []string{"lightning bolt", "bolt lightning", "LIGHTNING", "ning bo"} {
		if got := names(search(t, s, Search{Name: q})); !slices.Contains(got, "Lightning Bolt") {
			t.Errorf("%q found %q, want Lightning Bolt among them", q, got)
		}
	}
}

func TestSearchShowsOnePrintingPerCardPreferringNewestEnglish(t *testing.T) {
	s, _, ids := searchDB(t)
	p := search(t, s, Search{Name: "lightning"})
	if len(p.Cards) != 1 {
		t.Fatalf("got %q, want Lightning Bolt once", names(p))
	}
	// Newest is the Japanese printing; the newest English one is shown.
	if p.Cards[0].ID != ids[boltM19] {
		t.Errorf("shown printing = %s %s #%s, want the m19 English one", p.Cards[0].Lang, p.Cards[0].Set.Code, p.Cards[0].CollectorNumber)
	}
	// Restricted to a set, that set's printing is shown.
	p = search(t, s, Search{Name: "lightning", Set: "M10"})
	if len(p.Cards) != 1 || p.Cards[0].Set.Code != "m10" {
		t.Errorf("in m10: got %+v", p.Cards)
	}
}

func TestSearchPutsTheExactNameFirstThenNamesStartingWithIt(t *testing.T) {
	s, _, _ := searchDB(t)
	if got := names(search(t, s, Search{Name: "bolt"})); !reflect.DeepEqual(got, []string{"Bolt", "Boltwave", "Arc Bolt", "Lightning Bolt"}) {
		t.Errorf("bolt found %q", got)
	}
}

func TestSearchMatchesNameTextLiterally(t *testing.T) {
	s, _, _ := searchDB(t)
	// Unescaped, these would match Bolt: _ and % are wildcards, and \ escapes the next
	// letter. (Each has three letters in a row, so it gets past the index check.)
	for _, q := range []string{"bol_", "bol%", `bol\t`} {
		if got := names(search(t, s, Search{Name: q})); len(got) != 0 {
			t.Errorf("%q found %q, want nothing", q, got)
		}
	}
}

func TestSearchFilters(t *testing.T) {
	s, _, _ := searchDB(t)
	for _, tc := range []struct {
		name string
		q    Search
		want []string
	}{
		{"by set", Search{Set: "mh2"}, []string{"Fire // Ice", "Ragavan, Nimble Pilferer"}},
		{"by set and rarity", Search{Set: "mh2", Rarity: "mythic"}, []string{"Ragavan, Nimble Pilferer"}},
		{"by colour", Search{Set: "mh2", Colors: "r"}, []string{"Fire // Ice", "Ragavan, Nimble Pilferer"}},
		{"by colours, all of them", Search{Set: "mh2", Colors: "ur"}, []string{"Fire // Ice"}},
		{"colourless", Search{Set: "mh2", Colors: "c"}, []string{}},
		{"by type, its words in any order", Search{Name: "bolt", Type: "elf creature"}, []string{"Bolt", "Boltwave", "Arc Bolt"}},
		{"by type and colour", Search{Name: "lightning", Type: "instant", Colors: "R"}, []string{"Lightning Bolt"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := names(search(t, s, tc.q)); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSearchLeavesOutExtrasAndUnlistedCardsUnlessAsked(t *testing.T) {
	s, _, ids := searchDB(t)
	if got := names(search(t, s, Search{Name: "warrior"})); len(got) != 0 {
		t.Errorf("found %q, want the token left out", got)
	}
	if got := names(search(t, s, Search{Name: "warrior", IncludeExtras: true})); !reflect.DeepEqual(got, []string{"Elf Warrior"}) {
		t.Errorf("with extras found %q, want the token", got)
	}
	for _, c := range search(t, s, Search{Name: "ragavan"}).Cards {
		if c.ID == ids[ragavanGone] || c.NoLongerListed {
			t.Errorf("search showed a printing Scryfall no longer lists: %+v", c)
		}
	}
}

func TestSearchPages(t *testing.T) {
	s, _, _ := searchDB(t)
	first := search(t, s, Search{Name: "elvish pager"})
	if len(first.Cards) != PageSize || !first.HasMore || first.Page != 1 {
		t.Fatalf("page 1: %d cards, has_more %v", len(first.Cards), first.HasMore)
	}
	second := search(t, s, Search{Name: "elvish pager", Page: 2})
	if got := names(second); !reflect.DeepEqual(got, []string{fmt.Sprintf("Elvish Pager %02d", PageSize+1)}) || second.HasMore {
		t.Errorf("page 2: %q, has_more %v", got, second.HasMore)
	}
	if got := search(t, s, Search{Name: "elvish pager", Page: 3}); len(got.Cards) != 0 || got.Cards == nil {
		t.Errorf("page 3: %#v, want an empty list", got.Cards)
	}
}

func TestAutocomplete(t *testing.T) {
	s, _, _ := searchDB(t)
	got, err := s.Autocomplete(t.Context(), "bol")
	if err != nil {
		t.Fatal(err)
	}
	// Names that start with it, then ones with a word that does; within each, more printings
	// first (Lightning Bolt has three, Arc Bolt one), then by name.
	if want := []string{"Bolt", "Boltwave", "Lightning Bolt", "Arc Bolt"}; !reflect.DeepEqual(got.Names, want) {
		t.Errorf("bol: %q, want %q", got.Names, want)
	}
	for _, typed := range []string{"warrior", "b_l"} {
		if got, err := s.Autocomplete(t.Context(), typed); err != nil || len(got.Names) != 0 {
			t.Errorf("%q: %q, %v; want nothing", typed, got.Names, err)
		}
	}
}

func TestAutocompleteMatchesTypedTextLiterallyAcrossWords(t *testing.T) {
	s, _, _ := searchDB(t)
	got, err := s.Autocomplete(t.Context(), "pager 0")
	if err != nil {
		t.Fatal(err)
	}
	// Elvish Pager 01–09, by name (each has one printing).
	if len(got.Names) != 9 || got.Names[0] != "Elvish Pager 01" || got.Names[8] != "Elvish Pager 09" {
		t.Errorf("pager 0: %q", got.Names)
	}
}

func TestPrintingsListEveryPrintingNewestFirstIncludingUnlisted(t *testing.T) {
	s, _, ids := searchDB(t)
	p, err := s.Printings(t.Context(), rawCard(t, "m10-146").ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, c := range p.Cards {
		got = append(got, c.Lang+" "+c.Set.Code+" #"+c.CollectorNumber)
	}
	if want := []string{"ja m19 #998", "en m19 #999", "en m10 #146"}; !reflect.DeepEqual(got, want) {
		t.Errorf("Lightning Bolt printings = %q, want %q", got, want)
	}

	p, err = s.Printings(t.Context(), rawCard(t, "mh2-138").ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	var unlisted []string
	for _, c := range p.Cards {
		if c.NoLongerListed {
			unlisted = append(unlisted, c.ID)
		}
	}
	if len(p.Cards) != 2 || !reflect.DeepEqual(unlisted, []string{ids[ragavanGone]}) {
		t.Errorf("Ragavan printings: %d, unlisted %q; want 2 with the gone one marked", len(p.Cards), unlisted)
	}
}

func TestAnUnknownCardIsNotFound(t *testing.T) {
	s, _, _ := searchDB(t)
	const unknown = "00000000-0000-4000-8000-000000000000"
	if _, err := s.Card(t.Context(), unknown); !errors.Is(err, ErrNotFound) {
		t.Errorf("Card: err = %v, want ErrNotFound", err)
	}
	if _, err := s.Printings(t.Context(), unknown, 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("Printings: err = %v, want ErrNotFound", err)
	}
}
