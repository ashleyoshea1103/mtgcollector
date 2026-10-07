package cards

import (
	"database/sql/driver"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// Raw Scryfall API responses for the printings the frontend's fixtures are made from
// (frontend/scripts/fetch-fixtures.mjs), saved in testdata/.
var fixtureFiles = map[string]string{
	"lightningBolt": "m10-146",
	"ragavan":       "mh2-138",
	"delver":        "isd-51",
	"fireIce":       "mh2-290",
	"propaganda":    "sld-381",
	"llanowarElves": "m19-314",
}

func rawCard(t *testing.T, file string) scryfall.Card {
	t.Helper()
	b, err := os.ReadFile("testdata/" + file + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var c scryfall.Card
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// asJSON renders a row's fields the way the frontend fixtures (and later the API) spell them.
func asJSON(t *testing.T, row store.StageCardsParams) map[string]any {
	t.Helper()
	uuid := func(v driver.Valuer) any {
		s, err := v.Value()
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	cmc, err := row.Cmc.Float64Value()
	if err != nil {
		t.Fatal(err)
	}
	rawJSON := func(b []byte) any {
		if b == nil {
			return nil
		}
		var v any
		if err := json.Unmarshal(b, &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	strs := func(s []string) []any {
		out := make([]any, len(s))
		for i, v := range s {
			out[i] = v
		}
		return out
	}
	m := map[string]any{
		"id":               uuid(row.ID),
		"oracle_id":        uuid(row.OracleID),
		"name":             row.Name,
		"set_code":         row.SetCode,
		"collector_number": row.CollectorNumber,
		"rarity":           row.Rarity,
		"lang":             row.Lang,
		"mana_cost":        row.ManaCost,
		"cmc":              cmc.Float64,
		"type_line":        row.TypeLine,
		"colors":           strs(row.Colors),
		"color_identity":   strs(row.ColorIdentity),
		"images":           rawJSON(row.Images),
		"finishes":         strs(row.Finishes),
		"released_at":      row.ReleasedAt.Time.Format("2006-01-02"),
		"faces":            rawJSON(row.Faces),
		"oracle_text":      nil,
		"cardmarket_url":   nil,
	}
	if row.OracleText.Valid {
		m["oracle_text"] = row.OracleText.String
	}
	if row.CardmarketUrl.Valid {
		m["cardmarket_url"] = row.CardmarketUrl.String
	}
	return m
}

// The importer and the frontend's fixture script must map Scryfall's cards the same way:
// the fixtures are what the components were built and tested against. Prices are left
// out, as they change daily.
func TestMappingMatchesTheFrontendFixtures(t *testing.T) {
	b, err := os.ReadFile("../../../frontend/src/fixtures/cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]map[string]any
	if err := json.Unmarshal(b, &fixtures); err != nil {
		t.Fatal(err)
	}
	if len(fixtures) != len(fixtureFiles) {
		t.Fatalf("the frontend has %d fixture cards and testdata has %d; keep them in step", len(fixtures), len(fixtureFiles))
	}
	for key, file := range fixtureFiles {
		t.Run(key, func(t *testing.T) {
			row, err := toRow(rawCard(t, file))
			if err != nil {
				t.Fatalf("toRow: %v", err)
			}
			got, want := asJSON(t, row), fixtures[key]
			for field, g := range got {
				if w := want[field]; !reflect.DeepEqual(stripImageVersions(g), stripImageVersions(w)) {
					t.Errorf("%s:\n got  %v\n want %v", field, g, w)
				}
			}
		})
	}
}

// stripImageVersions drops the ?1234 cache-busting suffix Scryfall puts on image URLs,
// which changes whenever an image is re-scanned.
func stripImageVersions(v any) any {
	switch v := v.(type) {
	case string:
		if strings.HasPrefix(v, "https://"+scryfall.ImageHost+"/") {
			v, _, _ = strings.Cut(v, "?")
		}
		return v
	case map[string]any:
		out := map[string]any{}
		for k, e := range v {
			out[k] = stripImageVersions(e)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, e := range v {
			out[i] = stripImageVersions(e)
		}
		return out
	}
	return v
}

func TestPricesAreKeptExactly(t *testing.T) {
	c := rawCard(t, "m10-146")
	eur, foil := "1234.56", "0.07"
	c.Prices.EUR, c.Prices.EURFoil, c.Prices.USD = &eur, &foil, nil
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		got  driver.Valuer
		want any
	}{
		{"price_eur", row.PriceEur, "1234.56"},
		{"price_eur_foil", row.PriceEurFoil, "0.07"},
		{"price_usd", row.PriceUsd, nil},
	} {
		got, err := tc.got.Value()
		if err != nil {
			t.Fatal(err)
		}
		if got != tc.want {
			t.Errorf("%s = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestUntrustedURLsAreDropped(t *testing.T) {
	for _, url := range []string{
		"http://www.cardmarket.com/en/Magic/Products/Singles/x", // not https
		"https://www.cardmarket.com.evil.example/x",             // another host
		"https://user:pw@www.cardmarket.com/x",                  // credentials
		"https://evil.example/https://www.cardmarket.com/x",     // prefix trick
		"javascript:alert(1)//https://www.cardmarket.com/",      // not a web URL
		"https://www.cardmarket.com@evil.example/x",             // userinfo trick
		"//www.cardmarket.com/x",                                // no scheme
		"https://cards.scryfall.io/normal/front/x.jpg",          // a different trusted host
		"https://www.cardmarket.com:8443/x",                     // another port
		"\thttps://www.cardmarket.com/x",                        // leading whitespace
		"https://www.cardmarket.com/x\n<script>",                // control characters
		"https://WWW.CARDMARKET.COM.evil.example/x",             // case games
		"", // missing
	} {
		c := rawCard(t, "m10-146")
		c.PurchaseURIs.Cardmarket = url
		row, err := toRow(c)
		if err != nil {
			t.Fatal(err)
		}
		if row.CardmarketUrl.Valid {
			t.Errorf("cardmarket_url %q was kept", url)
		}
	}

	c := rawCard(t, "m10-146")
	c.ImageURIs.Large = "https://evil.example/large.jpg"
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	if row.Images != nil {
		t.Errorf("images kept with one off-host URL: %s", row.Images)
	}
}

func TestCardsThatCantBeImportedSayWhy(t *testing.T) {
	bad := "12.3.4"
	for name, spoil := range map[string]func(*scryfall.Card){
		"no id":            func(c *scryfall.Card) { c.ID = "" },
		"bad id":           func(c *scryfall.Card) { c.ID = "not-a-uuid" },
		"no oracle id":     func(c *scryfall.Card) { c.OracleID = "" },
		"no name":          func(c *scryfall.Card) { c.Name = "" },
		"no set":           func(c *scryfall.Card) { c.Set = "" },
		"unknown rarity":   func(c *scryfall.Card) { c.Rarity = "legendary" },
		"no finishes":      func(c *scryfall.Card) { c.Finishes = nil },
		"unknown finish":   func(c *scryfall.Card) { c.Finishes = []string{"nonfoil", "glossy"} },
		"no cmc":           func(c *scryfall.Card) { c.CMC = nil },
		"no type line":     func(c *scryfall.Card) { c.TypeLine = nil },
		"bad price":        func(c *scryfall.Card) { c.Prices.EUR = &bad },
		"NaN price":        func(c *scryfall.Card) { c.Prices.EUR = ptr("NaN") },
		"infinite price":   func(c *scryfall.Card) { c.Prices.USD = ptr("Inf") },
		"negative price":   func(c *scryfall.Card) { c.Prices.EURFoil = ptr("-1.00") },
		"exponent price":   func(c *scryfall.Card) { c.Prices.EUR = ptr("1e3") },
		"too big a price":  func(c *scryfall.Card) { c.Prices.EUR = ptr("123456789.00") },
		"empty price":      func(c *scryfall.Card) { c.Prices.EUR = ptr("") },
		"bad release date": func(c *scryfall.Card) { c.ReleasedAt = "07/10/2026" },
	} {
		t.Run(name, func(t *testing.T) {
			c := rawCard(t, "m10-146")
			spoil(&c)
			if _, err := toRow(c); err == nil {
				t.Error("toRow accepted it")
			}
		})
	}
}

func ptr(s string) *string { return &s }

func TestEmptyListsAreNotNull(t *testing.T) {
	// A colourless card's colours are [], which the contract (and the NOT NULL columns) need.
	c := rawCard(t, "m10-146")
	c.Colors, c.ColorIdentity = nil, nil
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	if row.Colors == nil || row.ColorIdentity == nil {
		t.Errorf("colors = %#v, color_identity = %#v; want empty, not nil", row.Colors, row.ColorIdentity)
	}
}

func TestSetRow(t *testing.T) {
	s := scryfall.Set{
		ID: "8db8b954-0cf5-4a86-a338-0c8795b557bf", Code: "mh2", Name: "Modern Horizons 2", SetType: "draft_innovation",
		ReleasedAt: "2021-06-18", IconSVGURI: "https://svgs.scryfall.io/sets/mh2.svg?1783000000", ParentSetCode: "",
	}
	row, err := setRow(s)
	if err != nil {
		t.Fatal(err)
	}
	if !row.IconSvgUri.Valid || row.ParentSetCode.Valid || row.ReleasedAt.Time.Format("2006-01-02") != "2021-06-18" {
		t.Errorf("setRow = %+v", row)
	}

	s.IconSVGURI = "https://evil.example/mh2.svg"
	if row, _ := setRow(s); row.IconSvgUri.Valid {
		t.Error("an off-host icon URL was kept")
	}
	s.ID = ""
	if _, err := setRow(s); err == nil {
		t.Error("a set without an id was accepted")
	}
}

// A multi-faced card (not reversible) without its own cost or colours: they come from the
// faces, joined like Scryfall writes split costs, with each colour once.
func TestCostAndColoursFromTheFaces(t *testing.T) {
	c := rawCard(t, "isd-51")
	c.ManaCost, c.Colors = nil, nil
	c.Faces[0].ManaCost, c.Faces[0].Colors = "{1}{R}", []string{"R"}
	c.Faces[1].ManaCost, c.Faces[1].Colors = "{1}{U}", []string{"U", "R"}
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	if row.ManaCost != "{1}{R} // {1}{U}" {
		t.Errorf("mana_cost = %q", row.ManaCost)
	}
	if !reflect.DeepEqual(row.Colors, []string{"R", "U"}) {
		t.Errorf("colors = %v", row.Colors)
	}
}

// A reversible card whose two faces are different cards (as in Tarkir: Dragonstorm) is
// named like the card's other printings, not after its first face.
func TestReversibleCardsWithDifferentFaces(t *testing.T) {
	c := rawCard(t, "sld-381")
	c.Faces[0].Name, c.Faces[0].ManaCost, c.Faces[0].TypeLine, c.Faces[0].Colors = "Scavenger Regent", "{3}{B}", "Creature — Dragon", []string{"B"}
	c.Faces[1].Name, c.Faces[1].ManaCost, c.Faces[1].TypeLine, c.Faces[1].Colors = "Exude Toxin", "{X}{B}{B}", "Sorcery — Omen", []string{"B"}
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	if row.Name != "Scavenger Regent // Exude Toxin" || row.ManaCost != "{3}{B} // {X}{B}{B}" ||
		row.TypeLine != "Creature — Dragon // Sorcery — Omen" || !reflect.DeepEqual(row.Colors, []string{"B"}) {
		t.Errorf("got %q, %q, %q, %v", row.Name, row.ManaCost, row.TypeLine, row.Colors)
	}
}

func TestEveryPriceAndTheCardmarketIDAreKept(t *testing.T) {
	c := rawCard(t, "m10-146")
	c.Prices = scryfall.Prices{EUR: ptr("1.01"), EURFoil: ptr("2.02"), USD: ptr("3.03"), USDFoil: ptr("4.04"), USDEtched: ptr("5.05")}
	id := int32(21219)
	c.CardmarketID = &id
	row, err := toRow(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []struct {
		name string
		got  driver.Valuer
		want string
	}{
		{"eur", row.PriceEur, "1.01"}, {"eur_foil", row.PriceEurFoil, "2.02"}, {"usd", row.PriceUsd, "3.03"},
		{"usd_foil", row.PriceUsdFoil, "4.04"}, {"usd_etched", row.PriceUsdEtched, "5.05"},
	} {
		if v, err := p.got.Value(); err != nil || v != p.want {
			t.Errorf("price %s = %v (%v), want %s", p.name, v, err, p.want)
		}
	}
	if !row.CardmarketID.Valid || row.CardmarketID.Int32 != 21219 {
		t.Errorf("cardmarket_id = %+v", row.CardmarketID)
	}
}

func TestCardsThePostgresColumnsWouldRejectAreSkipped(t *testing.T) {
	for name, spoil := range map[string]func(*scryfall.Card){
		"NUL in the name":       func(c *scryfall.Card) { c.Name = "Lightning\x00Bolt" },
		"NUL in the rules text": func(c *scryfall.Card) { c.OracleText = ptr("Deal 3\x00") },
		"NUL in a colour":       func(c *scryfall.Card) { c.Colors = []string{"R\x00"} },
		"odd set code":          func(c *scryfall.Card) { c.Set = "M10'" },
		"odd language":          func(c *scryfall.Card) { c.Lang = "english" },
		"long collector number": func(c *scryfall.Card) { c.CollectorNumber = strings.Repeat("9", 17) },
		"NUL in a face":         func(c *scryfall.Card) { c.Faces = []scryfall.Face{{Name: "A\x00"}} },
		"price too big":         func(c *scryfall.Card) { c.Prices.EUR = ptr("12345678912") },
		"price with junk":       func(c *scryfall.Card) { c.Prices.EUR = ptr("1x5") },
	} {
		t.Run(name, func(t *testing.T) {
			c := rawCard(t, "m10-146")
			spoil(&c)
			if _, err := toRow(c); err == nil {
				t.Error("toRow accepted it")
			}
		})
	}
}
