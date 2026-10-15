package collection

import (
	"encoding/base64"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/apperr"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

func TestKeys(t *testing.T) {
	for _, tc := range []struct {
		by      contract.GroupBy
		key     string
		ok      bool
		becomes string
	}{
		{contract.GroupByNone, "", true, "all"},
		{contract.GroupByNone, "all", true, "all"},
		{contract.GroupByNone, "R", false, ""},
		{contract.GroupByColor, "R", true, "R"},
		{contract.GroupByColor, "r", false, ""},
		{contract.GroupByColor, "", false, ""},
		{contract.GroupByType, "creature", true, "creature"},
		{contract.GroupByType, "Creature", false, ""},
		{contract.GroupByRarity, "mythic", true, "mythic"},
		{contract.GroupByCMC, "7", true, "7"},
		{contract.GroupByCMC, "8", false, ""},
		{contract.GroupBySet, "mh2", true, "mh2"},
		{contract.GroupBySet, "30a", true, "30a"},
		{contract.GroupBySet, "MH2", false, ""},
		{contract.GroupBySet, "mh2%", false, ""},
		{contract.GroupBySet, "abcdefghi", false, ""},
	} {
		q := EntryQuery{GroupBy: tc.by, Key: tc.key}
		err := checkKey(&q)
		if (err == nil) != tc.ok || tc.ok && q.Key != tc.becomes {
			t.Errorf("%s key %q: %v, key %q; want ok %v, %q", tc.by, tc.key, err, q.Key, tc.ok, tc.becomes)
		}
	}
}

func row(id int64, name string, price, cmc string, added time.Time) store.ListingRow {
	r := store.ListingRow{ID: id, Name: name, ListedAt: pgtype.Timestamptz{Time: added, Valid: true}}
	if price != "" {
		r.UnitPrice.Scan(price)
	}
	r.Cmc.Scan(cmc)
	return r
}

func TestACursorComesBackAsItWasMade(t *testing.T) {
	added := time.Date(2026, 3, 4, 5, 6, 7, 891011000, time.UTC)
	for _, sort := range []contract.SortBy{contract.SortByName, contract.SortByPrice, contract.SortByCMC, contract.SortByAdded} {
		for _, price := range []string{"12.34", ""} {
			q := EntryQuery{GroupBy: contract.GroupByColor, Key: "R", Sort: sort}
			made := cursorAfter(q, row(42, "Lightning Bolt", price, "1.5", added))
			back, err := decodeCursor(made.encode(), q)
			if err != nil {
				t.Fatalf("%s: %v", sort, err)
			}
			if back.ID != 42 || back.GroupBy != q.GroupBy || back.Key != "R" || back.Sort != sort {
				t.Errorf("%s: %+v", sort, back)
			}
			switch sort {
			case contract.SortByPrice:
				v, _ := back.Price.Value()
				if back.Unpriced != (price == "") || price != "" && v != price {
					t.Errorf("price %q: back unpriced %v, %v", price, back.Unpriced, v)
				}
			case contract.SortByCMC:
				v, _ := back.CMC.Value()
				if v != "1.5" || back.Name != "Lightning Bolt" {
					t.Errorf("cmc cursor: %v, %q", v, back.Name)
				}
			case contract.SortByAdded:
				if !back.Added.Equal(added) {
					t.Errorf("added = %v, want %v to the microsecond", back.Added, added)
				}
			default:
				if back.Name != "Lightning Bolt" {
					t.Errorf("name = %q", back.Name)
				}
			}
		}
	}
}

func TestACursorIsOnlyForItsListing(t *testing.T) {
	q := EntryQuery{GroupBy: contract.GroupByColor, Key: "R", Sort: contract.SortByCMC}
	c := cursorAfter(q, row(1, "Bolt", "1", "1", time.Now())).encode()
	for name, other := range map[string]EntryQuery{
		"another grouping": {GroupBy: contract.GroupByType, Key: "R", Sort: q.Sort},
		"another group":    {GroupBy: q.GroupBy, Key: "G", Sort: q.Sort},
		"another order":    {GroupBy: q.GroupBy, Key: q.Key, Sort: contract.SortByName},
	} {
		if _, err := decodeCursor(c, other); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if len(c) > maxCursorLength/2 {
		t.Errorf("a cursor is %d characters, too near the %d limit", len(c), maxCursorLength)
	}
	for _, tc := range []struct {
		sort contract.SortBy
		edit func(*cursor)
	}{
		{contract.SortByCMC, func(c *cursor) { c.CMC.Valid = false }},
		{contract.SortByAdded, func(c *cursor) { c.Added = time.Time{} }},
		{contract.SortByPrice, func(c *cursor) { c.Unpriced, c.Price.Valid = true, true }},
		{contract.SortByPrice, func(c *cursor) { c.Unpriced, c.Price.Valid = false, false }},
	} {
		q := EntryQuery{GroupBy: contract.GroupByNone, Key: "all", Sort: tc.sort}
		c := cursorAfter(q, row(1, "Bolt", "1", "1", time.Now()))
		tc.edit(&c)
		if _, err := decodeCursor(c.encode(), q); err == nil {
			t.Errorf("%s cursor without its sort key was accepted: %+v", tc.sort, c)
		}
	}
	nul := cursorAfter(q, row(1, "Bo\x00lt", "1", "1", time.Now()))
	if _, err := decodeCursor(nul.encode(), q); err == nil {
		t.Error("a cursor whose name has a NUL (which Postgres can't take) was accepted")
	}
	// Numbers Postgres wouldn't take, or that no price or mana value is.
	for _, raw := range []string{`1e-20000`, `1e20000`, `"NaN"`, `"Infinity"`, `"-Infinity"`, `123456789012345678901234567890`} {
		for _, sort := range []contract.SortBy{contract.SortByPrice, contract.SortByCMC} {
			field := map[contract.SortBy]string{contract.SortByPrice: "price", contract.SortByCMC: "cmc"}[sort]
			forged := base64.RawURLEncoding.EncodeToString([]byte(`{"v":1,"g":"none","k":"all","s":"` + string(sort) + `","id":1,"` + field + `":` + raw + `}`))
			if _, err := decodeCursor(forged, EntryQuery{GroupBy: contract.GroupByNone, Key: "all", Sort: sort}); err == nil {
				t.Errorf("%s cursor with %s %s was accepted", sort, field, raw)
			}
		}
	}
	for _, ok := range []string{"0", "0.5", "1000000", "12.34"} {
		var n pgtype.Numeric
		n.Scan(ok)
		if !plainNumber(n) {
			t.Errorf("%s isn't a plain number", ok)
		}
	}
	if _, err := decodeCursor(strings.Repeat("A", maxCursorLength+1), q); err == nil {
		t.Error("an over-long cursor was accepted")
	}
}

func TestASearchIsAPatternForEachWord(t *testing.T) {
	for _, tc := range []struct {
		q    string
		want []string
	}{
		{"", []string{}},
		{"  \t ", []string{}},
		{"bolt  Light", []string{"%bolt%", "%Light%"}},
		{`100%_a\b`, []string{`%100\%\_a\\b%`}},
		// Curly apostrophes (as phones type them) are the straight ones card names use.
		{"vryn’s ‘urza’s jace’", []string{"%vryn's%", "%'urza's%", "%jace'%"}},
		// A dash on its own is the one between card types ("Creature — Goblin"): no word to find.
		{"creature - goblin — – scout", []string{"%creature%", "%goblin%", "%scout%"}},
		{"-", []string{}},
	} {
		s, err := parseSearch(tc.q)
		if err != nil || s.patterns == nil || !slices.Equal(s.patterns, tc.want) {
			t.Errorf("parseSearch(%q) = %q, %v; want %q", tc.q, s.patterns, err, tc.want)
		}
		if len(tc.want) == 0 && s.digest != "" {
			t.Errorf("no search has digest %q, want none", s.digest)
		}
	}
	digest := func(q string) string {
		s, err := parseSearch(q)
		if err != nil {
			t.Fatal(err)
		}
		return s.digest
	}
	if a, b := digest(" bolt light "), digest("bolt light"); a == "" || a != b {
		t.Errorf("the same words have digests %q and %q", a, b)
	}
	if digest("bolt") == digest("bolt light") {
		t.Error("different searches have the same digest")
	}
}

func TestASearchTheServerCantRunIsRefused(t *testing.T) {
	for name, q := range map[string]string{
		"too long": strings.Repeat("a", contract.MaxSearchLength+1),
		"a NUL":    "bolt\x00",
		// Postgres refuses text that isn't UTF-8, which would fail the query (a 500).
		"bad UTF-8": "bolt\xff",
	} {
		if _, err := parseSearch(q); apperr.KindOf(err) != apperr.Invalid {
			t.Errorf("%s: %v, want invalid", name, err)
		}
	}
	// The cap is in characters, not bytes.
	if _, err := parseSearch(strings.Repeat("é", contract.MaxSearchLength)); err != nil {
		t.Errorf("%d characters: %v", contract.MaxSearchLength, err)
	}
}

func TestACursorIsOnlyForItsSearch(t *testing.T) {
	searched := func(q string) EntryQuery {
		s, err := parseSearch(q)
		if err != nil {
			t.Fatal(err)
		}
		return EntryQuery{GroupBy: contract.GroupByNone, Key: "all", Sort: contract.SortByName, Search: q, search: s}
	}
	goblin := cursorAfter(searched("goblin"), row(1, "Goblin Guide", "1", "1", time.Now())).encode()
	if _, err := decodeCursor(goblin, searched(" goblin ")); err != nil {
		t.Errorf("a cursor for the same search was refused: %v", err)
	}
	for name, other := range map[string]EntryQuery{"another search": searched("elf"), "no search": searched("")} {
		if _, err := decodeCursor(goblin, other); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	plain := cursorAfter(searched(""), row(1, "Bolt", "1", "1", time.Now())).encode()
	if _, err := decodeCursor(plain, searched("")); err != nil {
		t.Errorf("a cursor without a search was refused without one: %v", err)
	}
	if _, err := decodeCursor(plain, searched("goblin")); err == nil {
		t.Error("a cursor without a search was accepted for one")
	}
}

func TestEntryChecks(t *testing.T) {
	ok := func(q int, f contract.Finish, c contract.Condition, l contract.Language) bool {
		return checkEntry(q, f, c, l) == nil
	}
	if !ok(1, "foil", "NM", "en") || !ok(contract.MaxQuantity, "etched", "PO", "qya") {
		t.Error("a good entry was refused")
	}
	for name, good := range map[string]bool{
		"no copies":      ok(0, "foil", "NM", "en"),
		"too many":       ok(contract.MaxQuantity+1, "foil", "NM", "en"),
		"no finish":      ok(1, "", "NM", "en"),
		"bad condition":  ok(1, "foil", "nm", "en"),
		"bad language":   ok(1, "foil", "NM", "EN"),
		"empty language": ok(1, "foil", "NM", ""),
	} {
		if good {
			t.Errorf("%s was accepted", name)
		}
	}
	if checkFinish("etched", []string{"nonfoil", "foil"}) == nil || checkFinish("foil", []string{"nonfoil", "foil"}) != nil {
		t.Error("checkFinish")
	}
}
