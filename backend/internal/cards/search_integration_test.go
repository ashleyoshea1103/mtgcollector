//go:build integration

package cards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// Printings made from the fixture cards to exercise search; their ids are set in searchDB.
const (
	boltM19     = "Lightning Bolt in m19: English, released, a regular set (core)"
	boltJA      = "Lightning Bolt in Japanese, newer"
	boltSLD     = "Lightning Bolt in Secret Lair (a box set, not a regular one), newer"
	boltFuture  = "Lightning Bolt not released yet, newest"
	ragavanGone = "a newer Ragavan printing Scryfall no longer lists"
	vanished    = "a card whose only printing Scryfall no longer lists"
	elves9      = "Llanowar Elves m19 #9"
	elves10     = "Llanowar Elves m19 #10"
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
	// Lightning Bolt (m10 #146) gets more printings; search should show the m19 one.
	derive(boltM19, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt = "m19", "999", "2018-07-13"
	})
	derive(boltJA, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt, c.Lang = "m19", "998", "2020-01-01", "ja"
	})
	derive(boltSLD, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt = "sld", "9999", "2021-01-01"
	})
	derive(boltFuture, "m10-146", false, func(c *scryfall.Card) {
		c.Set, c.CollectorNumber, c.ReleasedAt = "m19", "997", "2099-01-01"
	})
	// Newer than the listed Ragavan, so it would be the one shown if gone cards weren't left out.
	derive(ragavanGone, "mh2-138", false, func(c *scryfall.Card) { c.CollectorNumber, c.ReleasedAt = "900", "2025-01-01" })
	derive(vanished, "m19-314", true, func(c *scryfall.Card) { c.Name, c.CollectorNumber = "Vanished Elf", "v1" })
	// More Llanowar Elves in m19: #9 and #10 sort before #314 as numbers, not as text.
	derive(elves9, "m19-314", false, func(c *scryfall.Card) { c.CollectorNumber = "9" })
	derive(elves10, "m19-314", false, func(c *scryfall.Card) { c.CollectorNumber = "10" })
	// Bolt is the exact name for "bolt"; Boltwave starts with it; A Bolt Apart and Arc Bolt
	// (one printing each) have a word starting with it, as Lightning Bolt (five) does; and
	// Symbolic Gesture only contains "bol".
	for _, name := range []string{"Bolt", "Boltwave", "A Bolt Apart", "Arc Bolt", "Symbolic Gesture"} {
		derive(name, "m19-314", true, func(c *scryfall.Card) { c.Name, c.CollectorNumber = name, "b-"+name[:3] })
	}
	// Non-game cards: by layout (a token) and by type line (a substitute card).
	derive("token", "m19-314", true, func(c *scryfall.Card) {
		tl := "Token Creature — Elf Warrior"
		c.Name, c.Layout, c.TypeLine, c.CollectorNumber = "Elf Warrior", "token", &tl, "t1"
	})
	derive("substitute", "m19-314", true, func(c *scryfall.Card) {
		tl := "Card"
		c.Name, c.TypeLine, c.CollectorNumber = "Substitute Elf", &tl, "s1"
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
	if _, err := pool.Exec(t.Context(), "UPDATE cards SET gone_since = now() WHERE id = ANY ($1)", []string{ids[ragavanGone], ids[vanished]}); err != nil {
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

func shown(p contract.CardPage, name string) contract.CardSummary {
	for _, c := range p.Cards {
		if c.Name == name {
			return c
		}
	}
	return contract.CardSummary{}
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
				// A key one side lacks isn't the same as a null (omitempty would do that).
				_, inGot := got[k]
				_, inWant := want[k]
				if inGot != inWant {
					t.Errorf("%s: in the API's card %v, in the fixture %v", k, inGot, inWant)
				} else if !reflect.DeepEqual(stripImageVersions(got[k]), stripImageVersions(want[k])) {
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

func TestSearchShowsAReleasedEnglishPrintingFromARegularSet(t *testing.T) {
	s, _, ids := searchDB(t)
	p := search(t, s, Search{Name: "lightning"})
	if len(p.Cards) != 1 {
		t.Fatalf("got %q, want Lightning Bolt once", names(p))
	}
	// Newer printings are Japanese, a Secret Lair one, and one not out yet: the newest
	// English, released, core-set printing is shown.
	if c := p.Cards[0]; c.ID != ids[boltM19] {
		t.Errorf("shown printing = %s %s #%s (%s), want the m19 English one", c.Lang, c.Set.Code, c.CollectorNumber, c.ReleasedAt)
	}
	// Restricted to a set, that set's printing is shown.
	p = search(t, s, Search{Name: "lightning", Set: "M10"})
	if len(p.Cards) != 1 || p.Cards[0].Set.Code != "m10" {
		t.Errorf("in m10: got %+v", p.Cards)
	}
}

func TestSearchRanksNamesStartingWithWhatWasTypedFirst(t *testing.T) {
	s, _, _ := searchDB(t)
	if got := names(search(t, s, Search{Name: "bolt"})); !reflect.DeepEqual(got, []string{"Bolt", "Boltwave", "A Bolt Apart", "Arc Bolt", "Lightning Bolt"}) {
		t.Errorf("bolt found %q", got)
	}
	// One-letter words count towards "starts with" (but needn't be looked up by index).
	if got := names(search(t, s, Search{Name: "a bolt"})); !reflect.DeepEqual(got, []string{"A Bolt Apart", "Arc Bolt", "Boltwave"}) {
		t.Errorf("a bolt found %q", got)
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
		{"by set and colour", Search{Set: "mh2", Colors: "r"}, []string{"Fire // Ice", "Ragavan, Nimble Pilferer"}},
		{"by set and all of some colours", Search{Set: "mh2", Colors: "ur"}, []string{"Fire // Ice"}},
		{"by set, colourless", Search{Set: "mh2", Colors: "c"}, []string{}},
		{"by set and type", Search{Set: "m19", Type: "instant"}, []string{"Lightning Bolt"}},
		{"by set and a name too short to look up alone", Search{Set: "mh2", Name: "ra"}, []string{"Ragavan, Nimble Pilferer"}},
		{"by name and rarity, in any case", Search{Name: "ragavan", Rarity: "MYTHIC"}, []string{"Ragavan, Nimble Pilferer"}},
		{"by name and another rarity", Search{Name: "ragavan", Rarity: "common"}, []string{}},
		{"by name and colour", Search{Name: "bolt", Colors: "g"}, []string{"Bolt", "Boltwave", "A Bolt Apart", "Arc Bolt"}},
		{"by name, colourless", Search{Name: "bolt", Colors: "c"}, []string{}},
		{"by name and type words in any order", Search{Name: "bolt", Type: "elf creature"}, []string{"Bolt", "Boltwave", "A Bolt Apart", "Arc Bolt"}},
		{"by name and type, literally", Search{Name: "bolt", Type: "elf_"}, []string{}},
		{"by name and type and colour", Search{Name: "lightning", Type: "instant", Colors: "R"}, []string{"Lightning Bolt"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := names(search(t, s, tc.q)); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestSetBrowsingShowsTheSetsBestPrinting(t *testing.T) {
	s, _, ids := searchDB(t)
	// (Narrowed by type and short name words: m19 has more than a page of cards here.)
	// English over Japanese, released over unreleased.
	if c := shown(search(t, s, Search{Set: "m19", Type: "instant"}), "Lightning Bolt"); c.ID != ids[boltM19] {
		t.Errorf("Lightning Bolt shown as %s #%s (%s), want the English, released #999", c.Lang, c.CollectorNumber, c.ReleasedAt)
	}
	// #9 before #10 and #314: numbers, not text.
	if c := shown(search(t, s, Search{Set: "m19", Name: "ll"}), "Llanowar Elves"); c.ID != ids[elves9] {
		t.Errorf("Llanowar Elves shown as #%s, want #9", c.CollectorNumber)
	}
}

func TestSearchLeavesOutExtrasUnlessAsked(t *testing.T) {
	s, _, _ := searchDB(t)
	// (In m19, "f" narrows it to fewer than a page: the extras and nothing else.)
	for _, q := range []Search{{Name: "elf"}, {Set: "m19", Name: "f"}} {
		got := names(search(t, s, q))
		if slices.Contains(got, "Elf Warrior") || slices.Contains(got, "Substitute Elf") {
			t.Errorf("%+v found %q, want the token and the substitute card left out", q, got)
		}
		q.IncludeExtras = true
		got = names(search(t, s, q))
		if !slices.Contains(got, "Elf Warrior") || !slices.Contains(got, "Substitute Elf") {
			t.Errorf("%+v with extras found %q, want the token and the substitute card", q, got)
		}
	}
}

func TestSearchLeavesOutPrintingsScryfallNoLongerLists(t *testing.T) {
	s, _, ids := searchDB(t)
	for _, q := range []Search{{Name: "ragavan"}, {Set: "mh2"}} {
		for _, c := range search(t, s, q).Cards {
			if c.ID == ids[ragavanGone] || c.NoLongerListed {
				t.Errorf("%+v showed a printing Scryfall no longer lists: %+v", q, c)
			}
		}
	}
	for _, q := range []Search{{Name: "vanished"}, {Set: "m19", Name: "vanished"}} {
		if got := names(search(t, s, q)); len(got) != 0 {
			t.Errorf("%+v found %q: a card with no listed printing", q, got)
		}
	}
	if got, err := s.Autocomplete(t.Context(), "vanish"); err != nil || len(got.Names) != 0 {
		t.Errorf("autocomplete vanish: %q, %v", got.Names, err)
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
	// Names that start with it; then ones with a word that does, more printings first
	// (Lightning Bolt has five), then by name; then names that only contain it.
	want := []string{"Bolt", "Boltwave", "Lightning Bolt", "A Bolt Apart", "Arc Bolt", "Symbolic Gesture"}
	if !reflect.DeepEqual(got.Names, want) {
		t.Errorf("bol: %q, want %q", got.Names, want)
	}
	for _, typed := range []string{"warrior", "substitute", "bol_"} {
		if got, err := s.Autocomplete(t.Context(), typed); err != nil || len(got.Names) != 0 {
			t.Errorf("%q: %q, %v; want nothing", typed, got.Names, err)
		}
	}
}

func TestAutocompleteMatchesTypedTextAcrossWords(t *testing.T) {
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
	printings := func(file string) []contract.CardSummary {
		t.Helper()
		p, err := s.Printings(t.Context(), rawCard(t, file).ID, 1)
		if err != nil {
			t.Fatal(err)
		}
		return p.Cards
	}
	var got []string
	for _, c := range printings("m10-146") {
		got = append(got, c.Lang+" "+c.Set.Code+" #"+c.CollectorNumber)
	}
	if want := []string{"en m19 #997", "en sld #9999", "ja m19 #998", "en m19 #999", "en m10 #146"}; !reflect.DeepEqual(got, want) {
		t.Errorf("Lightning Bolt printings = %q, want %q", got, want)
	}

	got = nil
	for _, c := range printings("m19-314") {
		got = append(got, c.CollectorNumber)
	}
	if want := []string{"9", "10", "314"}; !reflect.DeepEqual(got, want) {
		t.Errorf("Llanowar Elves printings = %q, want %q (numbers in order)", got, want)
	}

	var unlisted []string
	cards := printings("mh2-138")
	for _, c := range cards {
		if c.NoLongerListed {
			unlisted = append(unlisted, c.ID)
		}
	}
	if len(cards) != 2 || !reflect.DeepEqual(unlisted, []string{ids[ragavanGone]}) {
		t.Errorf("Ragavan printings: %d, unlisted %q; want 2 with the gone one marked", len(cards), unlisted)
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

// What a query whose time runs out really returns, through the pool the server uses (pgx
// cancels it, and Postgres says "canceling statement"): db.Error must say it timed out.
func TestDBErrorSaysARealQueryTimedOut(t *testing.T) {
	pool := testdb.New(t)
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	_, err := pool.Exec(ctx, "SELECT pg_sleep(5)")
	if err == nil {
		t.Fatal("pg_sleep(5) finished within 200ms")
	}
	if err := db.Error(ctx, "sleep", err); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("db.Error = %v, which doesn't say it timed out", err)
	}
}
