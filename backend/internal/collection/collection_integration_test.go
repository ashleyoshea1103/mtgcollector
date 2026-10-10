//go:build integration

package collection

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

// testCard is a printing to put in the database; the zero value of each field is a
// sensible default.
type testCard struct {
	name, set, rarity, typeLine string
	cmc                         float64
	identity, finishes          []string
	eur, eurFoil                *float64
	gone                        bool
}

func euros(v float64) *float64 { return &v }

type fixture struct {
	s        *Service
	pool     *pgxpool.Pool
	ann, bob int64 // two users
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool := testdb.New(t)
	f := &fixture{s: &Service{Q: store.New(pool)}, pool: pool}
	for _, u := range []*int64{&f.ann, &f.bob} {
		email := uuid(t) + "@example.com"
		if err := pool.QueryRow(t.Context(),
			`INSERT INTO users (email, password_hash) VALUES ($1, '$argon2id$test') RETURNING id`, email).Scan(u); err != nil {
			t.Fatal(err)
		}
	}
	// Three sets, released in this order.
	for _, s := range []struct{ code, name, released string }{
		{"aaa", "Alpha Test", "2001-01-01"}, {"bbb", "Beta Test", "2010-01-01"}, {"ccc", "Gamma Test", "2020-01-01"},
	} {
		if _, err := pool.Exec(t.Context(),
			`INSERT INTO sets (code, scryfall_id, name, set_type, released_at, icon_svg_uri)
			 VALUES ($1, $2, $3, 'expansion', $4, 'https://svgs.scryfall.io/sets/' || $1 || '.svg')`,
			s.code, uuid(t), s.name, s.released); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func uuid(t *testing.T) string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// card puts a printing in the database and returns its id.
func (f *fixture) card(t *testing.T, c testCard) string {
	t.Helper()
	c.name = cmpOr(c.name, "Card "+uuid(t)[:8])
	c.set = cmpOr(c.set, "aaa")
	c.rarity = cmpOr(c.rarity, "common")
	c.typeLine = cmpOr(c.typeLine, "Instant")
	if c.identity == nil {
		c.identity = []string{"R"}
	}
	if c.finishes == nil {
		c.finishes = []string{"nonfoil", "foil"}
	}
	id := uuid(t)
	_, err := f.pool.Exec(t.Context(),
		`INSERT INTO cards (id, oracle_id, name, lang, set_code, collector_number, rarity, layout, mana_cost, cmc,
		                    type_line, colors, color_identity, finishes, price_eur, price_eur_foil, released_at, gone_since)
		 VALUES ($1, $2, $3, 'en', $4, '1', $5, 'normal', '', $6, $7, $8, $8, $9, $10, $11, '2020-01-01',
		         CASE WHEN $12 THEN now() END)`,
		id, uuid(t), c.name, c.set, c.rarity, c.cmc, c.typeLine, c.identity, c.finishes, c.eur, c.eurFoil, c.gone)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func cmpOr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func newEntry(cardID string, quantity int) contract.NewEntry {
	return contract.NewEntry{CardID: cardID, Quantity: quantity, Finish: contract.FinishNonfoil, Condition: contract.ConditionNM, Language: contract.LanguageEnglish}
}

func (f *fixture) add(t *testing.T, user int64, e contract.NewEntry) contract.CollectionEntry {
	t.Helper()
	entry, _, err := f.s.Add(t.Context(), user, e)
	if err != nil {
		t.Fatalf("add %+v: %v", e, err)
	}
	return entry
}

func isInputError(err error) bool {
	var input *InputError
	return errors.As(err, &input)
}

// The server prices cards with the rules the frontend uses: every EUR case in the shared file.
func TestPricingMatchesTheSharedCases(t *testing.T) {
	pool := testdb.New(t)
	b, err := os.ReadFile("../../../testdata/pricing-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		PriceCases []struct {
			Name     string
			Prices   map[string]*float64
			Finish   string
			Currency string
			Expected *float64
		} `json:"price_cases"`
		ValueCases []struct {
			Name      string
			UnitPrice *float64 `json:"unit_price"`
			Quantity  int
			Expected  *float64
		} `json:"value_cases"`
	}
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, c := range cases.PriceCases {
		if c.Currency != "eur" {
			continue // the server's totals are EUR only
		}
		var got *float64
		if err := pool.QueryRow(t.Context(), `SELECT unit_price_eur($1, $2, $3)::float8`, c.Finish, c.Prices["eur"], c.Prices["eur_foil"]).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if !equalPrice(got, c.Expected) {
			t.Errorf("%s: unit_price_eur = %v, want %v", c.Name, show(got), show(c.Expected))
		}
		ran++
	}
	for _, c := range cases.ValueCases {
		var got *float64
		if err := pool.QueryRow(t.Context(), `SELECT line_value($1::numeric, $2)::float8`, c.UnitPrice, c.Quantity).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if !equalPrice(got, c.Expected) {
			t.Errorf("%s: line_value = %v, want %v", c.Name, show(got), show(c.Expected))
		}
		ran++
	}
	if ran < 8 {
		t.Errorf("only %d cases ran", ran)
	}
}

func equalPrice(a, b *float64) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

func show(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func TestCardGroups(t *testing.T) {
	pool := testdb.New(t)
	group := func(by, set string, identity []string, typeLine, rarity string, cmc float64) string {
		var key string
		if err := pool.QueryRow(t.Context(), `SELECT card_group($1, $2, $3, $4, $5, $6)`, by, set, identity, typeLine, rarity, cmc).Scan(&key); err != nil {
			t.Fatal(err)
		}
		return key
	}
	for typeLine, want := range map[string]string{
		"Creature — Elf":                        "creature",
		"Legendary Artifact Creature — Golem":   "creature",
		"Land Creature — Forest Dryad":          "creature",
		"Enchantment Creature — God":            "creature",
		"Creature — Human // Creature — Wolf":   "creature",
		"Legendary Planeswalker — Jace":         "planeswalker",
		"Battle — Siege":                        "battle",
		"Kindred Instant — Elf":                 "instant",
		"Instant // Instant":                    "instant",
		"Sorcery // Instant":                    "sorcery", // the front face's
		"Legendary Enchantment Artifact":        "artifact",
		"Artifact — Equipment":                  "artifact",
		"Enchantment — Aura":                    "enchantment",
		"Basic Land — Island":                   "land",
		"Land // Creature — Elf":                "land",
		"Conspiracy":                            "other",
		"Card":                                  "other",
		"Creatures":                             "other",    // whole words only
		"Legendary Creature — Planeswalker Elf": "creature", // subtypes don't count
	} {
		if got := group("type", "aaa", []string{}, typeLine, "rare", 1); got != want {
			t.Errorf("type of %q = %q, want %q", typeLine, got, want)
		}
	}
	for _, tc := range []struct {
		identity []string
		want     string
	}{{[]string{}, "C"}, {[]string{"G"}, "G"}, {[]string{"W"}, "W"}, {[]string{"U", "R"}, "M"}, {[]string{"W", "U", "B", "R", "G"}, "M"}} {
		if got := group("color", "aaa", tc.identity, "Instant", "rare", 1); got != tc.want {
			t.Errorf("color of %v = %q, want %q", tc.identity, got, tc.want)
		}
	}
	for cmc, want := range map[float64]string{0: "0", 0.5: "0", 1: "1", 6: "6", 6.5: "6", 7: "7", 16: "7", 1000000: "7"} {
		if got := group("cmc", "aaa", []string{}, "Instant", "rare", cmc); got != want {
			t.Errorf("cmc group of %v = %q, want %q", cmc, got, want)
		}
	}
	for by, want := range map[string]string{"set": "mh2", "rarity": "mythic", "none": "all"} {
		if got := group(by, "mh2", []string{}, "Instant", "mythic", 1); got != want {
			t.Errorf("%s group = %q, want %q", by, got, want)
		}
	}
	// Every fixed group's key is one the SQL can give, and every key it gives has a group.
	for by, groups := range fixedGroups {
		for _, g := range groups {
			if checkKey(&EntryQuery{GroupBy: by, Key: g.key}) != nil {
				t.Errorf("%s group %q fails checkKey", by, g.key)
			}
		}
	}
}

func TestAddingAnEntry(t *testing.T) {
	f := newFixture(t)
	bolt := f.card(t, testCard{name: "Lightning Bolt", eur: euros(1.5), eurFoil: euros(6)})
	e := newEntry(bolt, 3)
	e.Finish, e.Condition, e.Language = contract.FinishFoil, contract.ConditionEX, contract.LanguageGerman

	got, created, err := f.s.Add(t.Context(), f.ann, e)
	if err != nil || !created {
		t.Fatalf("add = %v, created %v", err, created)
	}
	if got.ID == 0 || got.Card.ID != bolt || got.Card.Name != "Lightning Bolt" || got.Quantity != 3 ||
		got.Finish != contract.FinishFoil || got.Condition != contract.ConditionEX || got.Language != contract.LanguageGerman {
		t.Errorf("entry = %+v", got)
	}
	if !equalPrice(got.UnitPriceEUR, euros(6)) || !equalPrice(got.ValueEUR, euros(18)) {
		t.Errorf("unit %v, value %v; want the foil price, 6, and 18", show(got.UnitPriceEUR), show(got.ValueEUR))
	}
	if got.AddedAt == "" || !strings.HasSuffix(got.AddedAt, "Z") {
		t.Errorf("added_at = %q, want an RFC 3339 time in UTC", got.AddedAt)
	}

	// The same card, finish, condition and language again: more copies of that entry.
	e.Quantity = 2
	again, created, err := f.s.Add(t.Context(), f.ann, e)
	if err != nil || created || again.ID != got.ID || again.Quantity != 5 {
		t.Errorf("adding again = %+v, created %v, %v; want entry %d with 5 copies", again, created, err, got.ID)
	}
	// Another condition: another entry.
	e.Condition = contract.ConditionNM
	other, created, _ := f.s.Add(t.Context(), f.ann, e)
	if !created || other.ID == got.ID {
		t.Errorf("another condition joined the first entry")
	}
	// Bob's copy is his own entry.
	bobs, created, _ := f.s.Add(t.Context(), f.bob, e)
	if !created || bobs.ID == other.ID {
		t.Errorf("Bob's add joined Ann's entry")
	}
}

func TestAddsTheServerRefuses(t *testing.T) {
	f := newFixture(t)
	foilOnly := f.card(t, testCard{finishes: []string{"foil"}})
	f.add(t, f.ann, contract.NewEntry{CardID: foilOnly, Quantity: 990, Finish: contract.FinishFoil, Condition: contract.ConditionNM, Language: contract.LanguageEnglish})
	group := int64(1)
	for name, edit := range map[string]func(*contract.NewEntry){
		"a finish the printing hasn't": func(e *contract.NewEntry) { e.Finish = contract.FinishNonfoil },
		"more than 999 in all":         func(e *contract.NewEntry) { e.Quantity = 10 },
		"no copies":                    func(e *contract.NewEntry) { e.Quantity = 0 },
		"too many copies":              func(e *contract.NewEntry) { e.Quantity = 1000 },
		"negative copies":              func(e *contract.NewEntry) { e.Quantity = -1 },
		"no finish":                    func(e *contract.NewEntry) { e.Finish = "" },
		"no condition":                 func(e *contract.NewEntry) { e.Condition = "" },
		"an unknown condition":         func(e *contract.NewEntry) { e.Condition = "mint" },
		"no language":                  func(e *contract.NewEntry) { e.Language = "" },
		"an unknown language":          func(e *contract.NewEntry) { e.Language = "xx" },
		"a card that doesn't exist":    func(e *contract.NewEntry) { e.CardID = uuid(t) },
		"a card id that isn't one":     func(e *contract.NewEntry) { e.CardID = "lightning bolt" },
		"a group (none exist yet)":     func(e *contract.NewEntry) { e.GroupID = &group },
	} {
		e := contract.NewEntry{CardID: foilOnly, Quantity: 9, Finish: contract.FinishFoil, Condition: contract.ConditionNM, Language: contract.LanguageEnglish}
		edit(&e)
		if _, _, err := f.s.Add(t.Context(), f.ann, e); !isInputError(err) {
			t.Errorf("%s: = %v, want an InputError", name, err)
		}
	}
	// Exactly 999 is fine.
	if _, _, err := f.s.Add(t.Context(), f.ann, contract.NewEntry{CardID: foilOnly, Quantity: 9, Finish: contract.FinishFoil, Condition: contract.ConditionNM, Language: contract.LanguageEnglish}); err != nil {
		t.Errorf("adding up to 999: %v", err)
	}
}

func TestACardNoLongerListedIsUnpriced(t *testing.T) {
	f := newFixture(t)
	gone := f.card(t, testCard{eur: nil, gone: true})
	e := f.add(t, f.ann, newEntry(gone, 2))
	if e.UnitPriceEUR != nil || e.ValueEUR != nil || !e.Card.NoLongerListed {
		t.Errorf("entry = %+v, want unpriced and no longer listed", e)
	}
	groups, _ := f.s.Groups(t.Context(), f.ann, contract.GroupByNone)
	if g := groups.Groups[0]; g.UnpricedCount != 2 || g.ValueEUR != 0 || g.CardCount != 2 {
		t.Errorf("totals = %+v, want 2 unpriced cards and no value", g.ValueTotal)
	}
}

func TestChangingAnEntry(t *testing.T) {
	f := newFixture(t)
	card := f.card(t, testCard{eur: euros(2), eurFoil: euros(5), finishes: []string{"nonfoil", "foil"}})
	e := f.add(t, f.ann, newEntry(card, 1))

	qty, foil, lp, ja := 4, contract.FinishFoil, contract.ConditionLP, contract.LanguageJapanese
	got, err := f.s.Change(t.Context(), f.ann, e.ID, contract.EntryChange{Quantity: &qty, Finish: &foil, Condition: &lp, Language: &ja})
	if err != nil || got.Quantity != 4 || got.Finish != foil || got.Condition != lp || got.Language != ja || !equalPrice(got.ValueEUR, euros(20)) {
		t.Errorf("change = %+v, %v", got, err)
	}
	// Only what's given changes.
	two := 2
	got, _ = f.s.Change(t.Context(), f.ann, e.ID, contract.EntryChange{Quantity: &two})
	if got.Quantity != 2 || got.Finish != foil || got.Condition != lp || got.Language != ja {
		t.Errorf("after changing only the quantity: %+v", got)
	}

	// A change that would make it the same as another entry.
	f.add(t, f.ann, newEntry(card, 1)) // nonfoil NM en
	nonfoil, nm, en := contract.FinishNonfoil, contract.ConditionNM, contract.LanguageEnglish
	if _, err := f.s.Change(t.Context(), f.ann, e.ID, contract.EntryChange{Finish: &nonfoil, Condition: &nm, Language: &en}); !errors.Is(err, ErrConflict) {
		t.Errorf("a change onto another entry = %v, want ErrConflict", err)
	}

	etched, zero, many, bad := contract.FinishEtched, 0, 1000, contract.Condition("mint")
	for name, c := range map[string]contract.EntryChange{
		"nothing":                      {},
		"a finish the printing hasn't": {Finish: &etched},
		"no copies":                    {Quantity: &zero},
		"too many copies":              {Quantity: &many},
		"an unknown condition":         {Condition: &bad},
	} {
		if _, err := f.s.Change(t.Context(), f.ann, e.ID, c); !isInputError(err) {
			t.Errorf("%s: = %v, want an InputError", name, err)
		}
	}
	if _, err := f.s.Change(t.Context(), f.bob, e.ID, contract.EntryChange{Quantity: &qty}); !errors.Is(err, ErrNotFound) {
		t.Errorf("Bob changing Ann's entry = %v, want ErrNotFound", err)
	}
	if after, _ := f.s.get(t.Context(), f.ann, e.ID); after.Quantity != 2 {
		t.Errorf("Ann's entry has %d copies after Bob's change, want 2", after.Quantity)
	}
}

func TestDeletingAnEntry(t *testing.T) {
	f := newFixture(t)
	e := f.add(t, f.ann, newEntry(f.card(t, testCard{}), 1))
	if err := f.s.Delete(t.Context(), f.bob, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Bob deleting Ann's entry = %v, want ErrNotFound", err)
	}
	if err := f.s.Delete(t.Context(), f.ann, e.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.s.Delete(t.Context(), f.ann, e.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting it again = %v, want ErrNotFound", err)
	}
}

// A small collection: Ann's cards, and one of Bob's that must never show up in hers.
func (f *fixture) collection(t *testing.T) {
	t.Helper()
	add := func(c testCard, quantity int, finish contract.Finish) {
		e := newEntry(f.card(t, c), quantity)
		e.Finish = finish
		f.add(t, f.ann, e)
	}
	add(testCard{name: "Delver", set: "bbb", identity: []string{"U"}, typeLine: "Creature — Human Wizard", rarity: "common", cmc: 1, eur: euros(0.5)}, 4, contract.FinishNonfoil)
	add(testCard{name: "Bolt", set: "aaa", identity: []string{"R"}, typeLine: "Instant", rarity: "uncommon", cmc: 1, eur: euros(1.25), eurFoil: euros(10)}, 2, contract.FinishFoil)
	add(testCard{name: "Fire // Ice", set: "ccc", identity: []string{"U", "R"}, typeLine: "Instant // Instant", rarity: "uncommon", cmc: 4, eur: euros(3)}, 1, contract.FinishNonfoil)
	add(testCard{name: "Elves", set: "ccc", identity: []string{"G"}, typeLine: "Creature — Elf", rarity: "rare", cmc: 2}, 3, contract.FinishNonfoil) // no price
	add(testCard{name: "Wastes", set: "aaa", identity: []string{}, typeLine: "Basic Land", rarity: "common", cmc: 0, eur: euros(0.1)}, 10, contract.FinishNonfoil)
	add(testCard{name: "Emrakul", set: "bbb", identity: []string{}, typeLine: "Legendary Creature — Eldrazi", rarity: "mythic", cmc: 15, eur: euros(20)}, 1, contract.FinishNonfoil)
	f.add(t, f.bob, newEntry(f.card(t, testCard{name: "Bob's card", set: "aaa", eur: euros(100)}), 7))
}

func TestGroups(t *testing.T) {
	f := newFixture(t)
	f.collection(t)
	type group struct {
		key, label     string
		entries, cards int
		value          float64
		unpriced       int
	}
	for by, want := range map[contract.GroupBy][]group{
		contract.GroupByNone: {{"all", "All cards", 6, 21, 20 + 1 + 3 + 2 + 20, 3}},
		contract.GroupByColor: {
			{"U", "Blue", 1, 4, 2, 0}, {"R", "Red", 1, 2, 20, 0}, {"G", "Green", 1, 3, 0, 3},
			{"M", "Multicolor", 1, 1, 3, 0}, {"C", "Colorless", 2, 11, 21, 0},
		},
		contract.GroupByType: {
			{"creature", "Creatures", 3, 8, 22, 3}, {"instant", "Instants", 2, 3, 23, 0}, {"land", "Lands", 1, 10, 1, 0},
		},
		contract.GroupByRarity: {
			{"mythic", "Mythic rare", 1, 1, 20, 0}, {"rare", "Rare", 1, 3, 0, 3}, {"uncommon", "Uncommon", 2, 3, 23, 0},
			{"common", "Common", 2, 14, 3, 0},
		},
		contract.GroupByCMC: {
			{"0", "0", 1, 10, 1, 0}, {"1", "1", 2, 6, 22, 0}, {"2", "2", 1, 3, 0, 3}, {"4", "4", 1, 1, 3, 0}, {"7", "7+", 1, 1, 20, 0},
		},
		// Newest set first.
		contract.GroupBySet: {
			{"ccc", "Gamma Test", 2, 4, 3, 3}, {"bbb", "Beta Test", 2, 5, 22, 0}, {"aaa", "Alpha Test", 2, 12, 21, 0},
		},
	} {
		res, err := f.s.Groups(t.Context(), f.ann, by)
		if err != nil {
			t.Fatalf("%s: %v", by, err)
		}
		var got []group
		for _, g := range res.Groups {
			got = append(got, group{g.Key, g.Label, g.EntryCount, g.CardCount, g.ValueEUR, g.UnpricedCount})
			if (by == contract.GroupBySet) != (g.Set != nil) {
				t.Errorf("%s group %s: set = %+v; want one exactly when grouping by set", by, g.Key, g.Set)
			}
			if g.Set != nil && (g.Set.Code != g.Key || g.Set.IconSVGURI == nil) {
				t.Errorf("set group %s carries set %+v", g.Key, g.Set)
			}
		}
		if res.GroupBy != by || !reflect.DeepEqual(got, want) {
			t.Errorf("%s:\n got  %v\n want %v", by, got, want)
		}
	}
	if _, err := f.s.Groups(t.Context(), f.ann, "price"); !isInputError(err) {
		t.Errorf("grouping by price = %v, want an InputError", err)
	}
}

func TestStats(t *testing.T) {
	f := newFixture(t)
	empty, err := f.s.Stats(t.Context(), f.ann)
	if err != nil || empty.CardCount != 0 || empty.UniqueCards != 0 || empty.ByColor == nil || empty.ByRarity == nil {
		t.Errorf("an empty collection's stats = %+v, %v", empty, err)
	}
	f.collection(t)
	got, err := f.s.Stats(t.Context(), f.ann)
	if err != nil {
		t.Fatal(err)
	}
	want := contract.CollectionStats{
		ValueTotal:  contract.ValueTotal{CardCount: 21, ValueEUR: 46, UnpricedCount: 3},
		UniqueCards: 6,
		ByColor:     map[string]int{"U": 4, "R": 2, "G": 3, "M": 1, "C": 11},
		ByRarity:    map[contract.Rarity]int{"mythic": 1, "rare": 3, "uncommon": 3, "common": 14},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("stats:\n got  %+v\n want %+v", got, want)
	}
}

// Every listing pages through all of one group's entries, in its order, each once.
func TestPagingThroughEveryOrder(t *testing.T) {
	f := newFixture(t)
	// 130 green entries over 26 cards: names, prices, mana values and (some) no prices that tie.
	var all []contract.CollectionEntry
	for i := range 26 {
		c := testCard{name: fmt.Sprintf("Card %02d", i%13), cmc: float64(i % 5), identity: []string{"G"}}
		if i%4 != 0 {
			c.eur = euros(float64(i%7) + 0.25)
		}
		id := f.card(t, c)
		for _, cond := range []contract.Condition{contract.ConditionMT, contract.ConditionNM, contract.ConditionEX, contract.ConditionGD, contract.ConditionLP} {
			e := newEntry(id, 1)
			e.Condition = cond
			all = append(all, f.add(t, f.ann, e))
		}
	}
	f.add(t, f.bob, newEntry(f.card(t, testCard{identity: []string{"G"}}), 1))
	// And three red ones: in the listing of every entry, but not the green group's.
	var red []contract.CollectionEntry
	for i := range 3 {
		red = append(red, f.add(t, f.ann, newEntry(f.card(t, testCard{name: fmt.Sprintf("Card %02d", i), identity: []string{"R"}, eur: euros(9)}), 1)))
	}

	for _, sort := range []contract.SortBy{contract.SortByName, contract.SortByPrice, contract.SortByCMC, contract.SortByAdded} {
		for _, q := range []EntryQuery{{GroupBy: contract.GroupByNone}, {GroupBy: contract.GroupByColor, Key: "G"}} {
			q.Sort = sort
			var got []contract.CollectionEntry
			var sizes []int
			for pages := 0; ; pages++ {
				if pages > 5 {
					t.Fatalf("%s: more pages than there are entries", sort)
				}
				page, err := f.s.Entries(t.Context(), f.ann, q)
				if err != nil {
					t.Fatalf("%s: %v", sort, err)
				}
				got = append(got, page.Entries...)
				sizes = append(sizes, len(page.Entries))
				if page.NextCursor == nil {
					break
				}
				q.Cursor = *page.NextCursor
			}
			want := slices.Clone(all)
			wantSizes := []int{60, 60, 10}
			if q.GroupBy == contract.GroupByNone {
				want, wantSizes = append(want, red...), []int{60, 60, 13}
			}
			if !slices.Equal(sizes, wantSizes) {
				t.Errorf("%s by %s: pages of %v, want %v", sort, q.GroupBy, sizes, wantSizes)
			}
			slices.SortStableFunc(want, order(sort))
			if ids(got) != ids(want) {
				t.Errorf("%s by %s: the pages' entries aren't every entry in order\n got  %s\n want %s", sort, q.GroupBy, ids(got), ids(want))
			}
		}
	}
}

// order is a listing's order, as the queries say it.
func order(sort contract.SortBy) func(a, b contract.CollectionEntry) int {
	return func(a, b contract.CollectionEntry) int {
		byID := compare(a.ID, b.ID)
		switch sort {
		case contract.SortByPrice:
			if (a.UnitPriceEUR == nil) != (b.UnitPriceEUR == nil) {
				return map[bool]int{true: 1, false: -1}[a.UnitPriceEUR == nil]
			}
			if a.UnitPriceEUR != nil && *a.UnitPriceEUR != *b.UnitPriceEUR {
				return compare(*b.UnitPriceEUR, *a.UnitPriceEUR)
			}
			return byID
		case contract.SortByCMC:
			if a.Card.CMC != b.Card.CMC {
				return compare(a.Card.CMC, b.Card.CMC)
			}
			if a.Card.Name != b.Card.Name {
				return strings.Compare(a.Card.Name, b.Card.Name)
			}
			return byID
		case contract.SortByAdded:
			if a.AddedAt != b.AddedAt {
				return strings.Compare(b.AddedAt, a.AddedAt)
			}
			return -byID // within a second, by id: the RFC 3339 time has whole seconds
		default:
			if a.Card.Name != b.Card.Name {
				return strings.Compare(a.Card.Name, b.Card.Name)
			}
			return byID
		}
	}
}

func compare[T int64 | float64](a, b T) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func ids(entries []contract.CollectionEntry) string {
	s := make([]string, len(entries))
	for i, e := range entries {
		s[i] = fmt.Sprint(e.ID)
	}
	return strings.Join(s, " ")
}

func TestABadListingIsRefused(t *testing.T) {
	f := newFixture(t)
	for range 2 {
		for _, cond := range []contract.Condition{contract.ConditionMT, contract.ConditionNM, contract.ConditionEX} {
			for range 21 {
				e := newEntry(f.card(t, testCard{eur: euros(1)}), 1) // priced, so a cursor has a price
				e.Condition = cond
				f.add(t, f.ann, e)
			}
		}
	}
	first, err := f.s.Entries(t.Context(), f.ann, EntryQuery{Sort: contract.SortByPrice})
	if err != nil || first.NextCursor == nil {
		t.Fatalf("first page: %v, next %v", err, first.NextCursor)
	}
	next := *first.NextCursor
	for name, q := range map[string]EntryQuery{
		"an unknown grouping":        {GroupBy: "price"},
		"an unknown order":           {Sort: "random"},
		"no key":                     {GroupBy: contract.GroupByColor},
		"a key the grouping hasn't":  {GroupBy: contract.GroupByColor, Key: "X"},
		"a key of another grouping":  {GroupBy: contract.GroupByType, Key: "R"},
		"a set code that isn't one":  {GroupBy: contract.GroupBySet, Key: "MH2'; --"},
		"a key with no grouping":     {Key: "R"},
		"a cursor for another order": {Sort: contract.SortByName, Cursor: next},
		"a cursor for another group": {GroupBy: contract.GroupByColor, Key: "R", Sort: contract.SortByPrice, Cursor: next},
		"a cursor that isn't base64": {Sort: contract.SortByPrice, Cursor: "!!!"},
		"a cursor that isn't JSON":   {Sort: contract.SortByPrice, Cursor: "bm90IGpzb24"},
		"a cursor too long":          {Sort: contract.SortByPrice, Cursor: strings.Repeat("A", maxCursorLength+1)},
		"an old version of cursor":   {Sort: contract.SortByPrice, Cursor: forged(t, next, func(c *cursor) { c.Version = 0 })},
		"a cursor without its price": {Sort: contract.SortByPrice, Cursor: forged(t, next, func(c *cursor) { c.Price.Valid = false })},
	} {
		if _, err := f.s.Entries(t.Context(), f.ann, q); !isInputError(err) {
			t.Errorf("%s: = %v, want an InputError", name, err)
		}
	}
	if _, err := f.s.Entries(t.Context(), f.ann, EntryQuery{Sort: contract.SortByPrice, Cursor: next}); err != nil {
		t.Errorf("the cursor itself: %v", err)
	}
	if page, err := f.s.Entries(t.Context(), f.ann, EntryQuery{Key: "all"}); err != nil || len(page.Entries) != PageSize {
		t.Errorf("key all with no grouping: %d entries, %v", len(page.Entries), err)
	}
	// Bob, with Ann's cursor, sees only his own (no) entries.
	if page, err := f.s.Entries(t.Context(), f.bob, EntryQuery{Sort: contract.SortByPrice, Cursor: next}); err != nil || len(page.Entries) != 0 {
		t.Errorf("Bob with Ann's cursor: %d entries, %v", len(page.Entries), err)
	}
}

func forged(t *testing.T, s string, edit func(*cursor)) string {
	t.Helper()
	c, err := decodeCursor(s, EntryQuery{GroupBy: contract.GroupByNone, Key: "all", Sort: contract.SortByPrice})
	if err != nil {
		t.Fatal(err)
	}
	edit(&c)
	return c.encode()
}

// What the API sends never has a null where the TypeScript says a list or map.
func TestResultsHaveNoNilListsOrMaps(t *testing.T) {
	f := newFixture(t)
	check := func(name string, v any, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if path := nilCollection(reflect.ValueOf(v), name); path != "" {
			t.Errorf("%s is nil", path)
		}
	}
	for _, populated := range []bool{false, true} {
		if populated {
			f.collection(t)
		}
		for _, by := range []contract.GroupBy{contract.GroupByNone, contract.GroupBySet, contract.GroupByColor} {
			g, err := f.s.Groups(t.Context(), f.ann, by)
			check("groups", g, err)
		}
		p, err := f.s.Entries(t.Context(), f.ann, EntryQuery{})
		check("entries", p, err)
		s, err := f.s.Stats(t.Context(), f.ann)
		check("stats", s, err)
	}
}

// nilCollection is the path to a nil slice or map in v, or "" if there's none. Pointers
// may be nil (they're null in the TypeScript too).
func nilCollection(v reflect.Value, path string) string {
	switch v.Kind() {
	case reflect.Slice, reflect.Map:
		if v.IsNil() {
			return path
		}
		if v.Kind() == reflect.Slice {
			for i := range v.Len() {
				if p := nilCollection(v.Index(i), fmt.Sprintf("%s[%d]", path, i)); p != "" {
					return p
				}
			}
		}
	case reflect.Pointer:
		if !v.IsNil() {
			return nilCollection(v.Elem(), path)
		}
	case reflect.Struct:
		for i := range v.NumField() {
			if p := nilCollection(v.Field(i), path+"."+v.Type().Field(i).Name); p != "" {
				return p
			}
		}
	}
	return ""
}
