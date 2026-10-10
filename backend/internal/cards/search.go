package cards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// What isn't a card you play with: tokens, emblems, art cards, planes, schemes, Vanguard
// cards and Jumpstart theme cards (by layout), and substitute cards, stickers, dungeons,
// Theros "Hero" cards and tokens printed in other layouts (by type line). Search and
// autocomplete leave them out unless asked; a card's own printings include everything.
var (
	extraLayouts = []string{"token", "double_faced_token", "art_series", "emblem", "planar", "scheme", "vanguard", "front_card"}
	extraTypes   = []string{"Token %", "Card", "Card %", "Stickers", "Stickers %", "Dungeon", "Dungeon %", "Hero", "Hero %"}
)

// Kinds of set whose printings are a card's usual look and price, so search shows one of
// them before a promo, Secret Lair or other special printing.
var regularSetTypes = []string{"core", "expansion", "masters", "draft_innovation", "commander"}

const (
	// PageSize is how many cards a page of search results or printings holds.
	PageSize = 60
	// MaxPage is the last page served: deep pages are slow and nobody reads that far.
	MaxPage = 50
	// MinSearchWord is how many letters or digits in a row a name search needs in one of
	// its words to look the name up by index (pg_trgm's trigrams); without one, a set must
	// be given.
	MinSearchWord = 3
	// MinAutocomplete is how many letters or digits in a row must be typed before names
	// are suggested.
	MinAutocomplete = 3
	// MaxQueryLength caps what's typed (characters). The longest card name is 141.
	MaxQueryLength = 150
	// autocompleteLimit is how many names autocomplete suggests.
	autocompleteLimit = 20
	// queryTimeout bounds each database query the search runs.
	queryTimeout = 5 * time.Second
)

// ErrNotFound means there's no card with the given id.
var ErrNotFound = errors.New("card not found")

// A QueryError is a search the caller asked for wrongly; its message is safe to show them.
type QueryError struct{ Reason string }

func (e *QueryError) Error() string { return e.Reason }

func invalid(format string, args ...any) error {
	return &QueryError{Reason: fmt.Sprintf(format, args...)}
}

// Search is a card search, as parsed from a request.
type Search struct {
	// Words the card's name must contain, in any order ("bolt light" finds Lightning Bolt).
	Name string
	// A set code, e.g. "mh2": only cards printed in that set, shown as that printing.
	Set string
	// Words the type line must contain, in any order (e.g. "creature goblin").
	Type string
	// Only cards of this rarity (in the printing shown).
	Rarity contract.Rarity
	// Only cards that are all of these colours (W U B R G), or colourless ("C" alone).
	Colors string
	// Include tokens, emblems, art cards and other non-game cards.
	IncludeExtras bool
	// From 1.
	Page int
}

// Searcher answers the card API's queries from the imported cards.
type Searcher struct {
	Q *store.Queries
}

// Search returns a page of matching cards, one printing each: an English one if there is,
// one that's been released, one from a regular set (not a promo or special printing), then
// the newest. Restricted to a set, it's that set's printing.
func (s *Searcher) Search(ctx context.Context, q Search) (contract.CardPage, error) {
	if err := checkPage(q.Page); err != nil {
		return contract.CardPage{}, err
	}
	if utf8.RuneCountInString(q.Name) > MaxQueryLength || utf8.RuneCountInString(q.Type) > MaxQueryLength {
		return contract.CardPage{}, invalid("that's longer than any card's name or type")
	}
	set := strings.ToLower(strings.TrimSpace(q.Set))
	if set != "" && !setCodeFormat.MatchString(set) {
		return contract.CardPage{}, invalid("set must be a set code, like mh2")
	}
	words := strings.Fields(q.Name)
	// The word with the most letters in a row leads: it's what the name index can use.
	lead := ""
	if len(words) > 0 {
		lead = slices.MaxFunc(words, func(a, b string) int { return longestRun(a) - longestRun(b) })
	}
	byName := longestRun(lead) >= MinSearchWord
	if !byName && set == "" {
		return contract.CardPage{}, invalid("give a name with at least %d letters in a row, or a set", MinSearchWord)
	}
	rarity := pgtype.Text{}
	if q.Rarity != "" {
		r := strings.ToLower(string(q.Rarity))
		if !slices.Contains(knownRarities, r) {
			return contract.CardPage{}, invalid("rarity must be one of %s", strings.Join(knownRarities, ", "))
		}
		rarity = pgtype.Text{String: r, Valid: true}
	}
	colors, colorless, err := parseColors(q.Colors)
	if err != nil {
		return contract.CardPage{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	limit, offset := pageWindow(q.Page)
	var rows []store.CardListing
	if byName {
		res, err := s.Q.SearchCardsByName(ctx, store.SearchCardsByNameParams{
			LeadPattern: contains(lead), NamePatterns: containsEach(words),
			IncludeExtras: q.IncludeExtras, ExtraLayouts: extraLayouts, ExtraTypes: extraTypes,
			SetCode: pgtype.Text{String: set, Valid: set != ""}, Rarity: rarity, TypePatterns: containsEach(strings.Fields(q.Type)),
			Colors: colors, Colorless: colorless, RegularSetTypes: regularSetTypes,
			PrefixPattern: likeEscape(strings.Join(words, " ")) + "%",
			RowLimit:      limit, RowOffset: offset,
		})
		if err != nil {
			return contract.CardPage{}, db.Error(ctx, "search cards by name", err)
		}
		for _, r := range res {
			rows = append(rows, r.CardListing)
		}
	} else {
		res, err := s.Q.SearchCardsInSet(ctx, store.SearchCardsInSetParams{
			SetCode: set, NamePatterns: containsEach(words),
			IncludeExtras: q.IncludeExtras, ExtraLayouts: extraLayouts, ExtraTypes: extraTypes,
			Rarity: rarity, TypePatterns: containsEach(strings.Fields(q.Type)), Colors: colors, Colorless: colorless,
			RowLimit: limit, RowOffset: offset,
		})
		if err != nil {
			return contract.CardPage{}, db.Error(ctx, "search cards in set", err)
		}
		for _, r := range res {
			rows = append(rows, r.CardListing)
		}
	}
	return page(rows, q.Page)
}

// Autocomplete suggests card names containing what's been typed, best matches first.
// Until MinAutocomplete letters or digits in a row are typed, it suggests nothing.
func (s *Searcher) Autocomplete(ctx context.Context, typed string) (contract.CardNames, error) {
	typed = strings.Join(strings.Fields(typed), " ")
	if utf8.RuneCountInString(typed) > MaxQueryLength {
		return contract.CardNames{}, invalid("that's longer than any card's name")
	}
	// What the index can look up: "l i" or "'''" can't be.
	if longestRun(typed) < MinAutocomplete {
		return contract.CardNames{Names: []string{}}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	esc := likeEscape(typed)
	names, err := s.Q.AutocompleteNames(ctx, store.AutocompleteNamesParams{
		NamePattern: "%" + esc + "%", ExtraLayouts: extraLayouts, ExtraTypes: extraTypes,
		PrefixPattern: esc + "%", WordPrefixPattern: "% " + esc + "%",
		RowLimit: autocompleteLimit,
	})
	if err != nil {
		return contract.CardNames{}, db.Error(ctx, "autocomplete", err)
	}
	return contract.CardNames{Names: nonNil(names)}, nil
}

// Card returns one printing with everything the detail view shows.
func (s *Searcher) Card(ctx context.Context, id string) (contract.Card, error) {
	uuid, err := parseID(id)
	if err != nil {
		return contract.Card{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	row, err := s.Q.GetCard(ctx, uuid)
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.Card{}, ErrNotFound
	}
	if err != nil {
		return contract.Card{}, db.Error(ctx, "get card", err)
	}
	return toCard(row.CardListing)
}

// Printings returns a page of every printing of the card the given printing is of, newest
// first, including ones Scryfall no longer lists.
func (s *Searcher) Printings(ctx context.Context, id string, pageNo int) (contract.CardPage, error) {
	uuid, err := parseID(id)
	if err != nil {
		return contract.CardPage{}, err
	}
	if err := checkPage(pageNo); err != nil {
		return contract.CardPage{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	oracleID, err := s.Q.CardOracleID(ctx, uuid)
	if errors.Is(err, pgx.ErrNoRows) {
		return contract.CardPage{}, ErrNotFound
	}
	if err != nil {
		return contract.CardPage{}, db.Error(ctx, "card oracle id", err)
	}
	limit, offset := pageWindow(pageNo)
	res, err := s.Q.CardPrintings(ctx, store.CardPrintingsParams{OracleID: oracleID, RowLimit: limit, RowOffset: offset})
	if err != nil {
		return contract.CardPage{}, db.Error(ctx, "card printings", err)
	}
	rows := make([]store.CardListing, len(res))
	for i, r := range res {
		rows[i] = r.CardListing
	}
	return page(rows, pageNo)
}

func checkPage(n int) error {
	if n < 1 || n > MaxPage {
		return invalid("page must be from 1 to %d", MaxPage)
	}
	return nil
}

// pageWindow is the rows to fetch for a page: one more than a page, to tell if there's a next.
func pageWindow(n int) (limit, offset int32) {
	return PageSize + 1, int32((n - 1) * PageSize)
}

func page(rows []store.CardListing, n int) (contract.CardPage, error) {
	// Never more after MaxPage, as the next page would be refused.
	p := contract.CardPage{Cards: make([]contract.CardSummary, 0, min(len(rows), PageSize)), Page: n, HasMore: len(rows) > PageSize && n < MaxPage}
	for _, r := range rows[:min(len(rows), PageSize)] {
		c, err := toSummary(r)
		if err != nil {
			return contract.CardPage{}, err
		}
		p.Cards = append(p.Cards, c)
	}
	return p, nil
}

// A Scryfall id in its usual form (pgtype would also accept other separators, or none).
var idFormat = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func parseID(id string) (pgtype.UUID, error) {
	if !idFormat.MatchString(id) {
		return pgtype.UUID{}, invalid("card id must be a Scryfall id, like 0b8fe8b3-…")
	}
	return parseUUID(id)
}

// longestRun is the most letters and digits in a row in s. pg_trgm only finds trigrams in
// such runs, so a pattern without a run of three ("---", "ab-c") can't use the name index
// and would scan every card.
func longestRun(s string) int {
	best, run := 0, 0
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			run++
			best = max(best, run)
		} else {
			run = 0
		}
	}
	return best
}

// parseColors reads a colour filter: some of W U B R G (in any order, any case), or C for
// colourless. It returns the colours the card must all have, and whether it must have none.
func parseColors(s string) (colors []string, colorless bool, err error) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if s == "C" {
		return []string{}, true, nil
	}
	colors = []string{}
	for _, r := range s {
		c := string(r)
		if !strings.ContainsRune("WUBRG", r) {
			return nil, false, invalid("colors must be letters from WUBRG, or C for colourless")
		}
		if !slices.Contains(colors, c) {
			colors = append(colors, c)
		}
	}
	return colors, false, nil
}

// contains is an ILIKE pattern matching text that contains s.
func contains(s string) string { return "%" + likeEscape(s) + "%" }

// containsEach is a pattern for each word; an empty list matches everything.
func containsEach(words []string) []string {
	patterns := make([]string, len(words))
	for i, w := range words {
		patterns[i] = contains(w)
	}
	return patterns
}

// likeEscape makes text match itself literally in an ILIKE pattern (whose escape is \).
func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func toSummary(r store.CardListing) (contract.CardSummary, error) {
	c := contract.CardSummary{
		ID: uuidString(r.ID), OracleID: uuidString(r.OracleID), Name: r.Name,
		Set:             contract.CardSet{Code: r.SetCode, Name: r.SetName, IconSVGURI: textPtr(r.SetIconSvgUri)},
		CollectorNumber: r.CollectorNumber, Rarity: contract.Rarity(r.Rarity), Lang: r.Lang,
		ManaCost: r.ManaCost, TypeLine: r.TypeLine,
		Colors: nonNil(r.Colors), ColorIdentity: nonNil(r.ColorIdentity),
		Prices: contract.Prices{
			EUR: numberPtr(r.PriceEur), EURFoil: numberPtr(r.PriceEurFoil),
			USD: numberPtr(r.PriceUsd), USDFoil: numberPtr(r.PriceUsdFoil), USDEtched: numberPtr(r.PriceUsdEtched),
		},
		Finishes:       make([]contract.Finish, len(r.Finishes)),
		ReleasedAt:     r.ReleasedAt.Time.Format(time.DateOnly),
		NoLongerListed: r.GoneSince.Valid,
	}
	if cmc := numberPtr(r.Cmc); cmc != nil {
		c.CMC = *cmc
	}
	for i, f := range r.Finishes {
		c.Finishes[i] = contract.Finish(f)
	}
	if r.Images != nil {
		if err := json.Unmarshal(r.Images, &c.Images); err != nil {
			return c, fmt.Errorf("card %s images: %w", c.ID, err)
		}
	}
	return c, nil
}

func toCard(r store.CardListing) (contract.Card, error) {
	summary, err := toSummary(r)
	if err != nil {
		return contract.Card{}, err
	}
	c := contract.Card{CardSummary: summary, OracleText: textPtr(r.OracleText), CardmarketURL: textPtr(r.CardmarketUrl)}
	if r.Faces != nil {
		if err := json.Unmarshal(r.Faces, &c.Faces); err != nil {
			return c, fmt.Errorf("card %s faces: %w", c.ID, err)
		}
	}
	return c, nil
}

func uuidString(u pgtype.UUID) string {
	v, _ := u.Value() // a valid UUID's string form; the columns are NOT NULL
	s, _ := v.(string)
	return s
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func numberPtr(n pgtype.Numeric) *float64 {
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return nil
	}
	return &f.Float64
}
