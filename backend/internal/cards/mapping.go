package cards

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// A price as Scryfall writes them ("0.31"), small enough for numeric(10,2).
var priceFormat = regexp.MustCompile(`^[0-9]{1,8}(\.[0-9]{1,2})?$`)

// What Scryfall's codes look like; the cards and sets tables check the same.
var (
	setCodeFormat = regexp.MustCompile(`^[a-z0-9]{1,8}$`)
	langFormat    = regexp.MustCompile(`^[a-z]{2,3}$`)
)

const maxCollectorNumber = 16 // characters; Scryfall's longest is 9

var (
	knownRarities = []string{"common", "uncommon", "rare", "mythic", "special", "bonus"}
	knownFinishes = []string{string(contract.FinishNonfoil), string(contract.FinishFoil), string(contract.FinishEtched)}
)

// toRow maps a Scryfall card to a row for the cards table, or says why it can't be
// imported. It applies the same rules as frontend/scripts/fetch-fixtures.mjs; the tests
// check the two agree on real cards.
func toRow(c scryfall.Card) (store.StageCardsParams, error) {
	var row store.StageCardsParams
	var front *scryfall.Face
	if len(c.Faces) > 0 {
		front = &c.Faces[0]
	}
	// Reversible cards put everything on the faces, and their top-level name repeats faces
	// ("Propaganda // Propaganda"); other multi-face layouts (split, transform...) describe
	// the whole card at the top level. For reversible cards, each distinct face name, cost
	// and type is taken once, which gives the name other printings of the card have.
	reversible := c.Layout == "reversible_card" && front != nil

	var err error
	if row.ID, err = parseUUID(c.ID); err != nil {
		return row, fmt.Errorf("id: %w", err)
	}
	oracleID := c.OracleID
	if oracleID == "" && front != nil {
		oracleID = front.OracleID
	}
	if row.OracleID, err = parseUUID(oracleID); err != nil {
		return row, fmt.Errorf("oracle_id: %w", err)
	}

	row.Name = c.Name
	if reversible {
		row.Name = joinDistinct(c.Faces, func(f scryfall.Face) string { return f.Name })
	}
	row.Lang = c.Lang
	row.SetCode = c.Set
	row.CollectorNumber = c.CollectorNumber
	row.Layout = c.Layout
	for _, f := range []struct{ name, value string }{
		{"name", row.Name}, {"lang", row.Lang}, {"set", row.SetCode}, {"collector_number", row.CollectorNumber},
	} {
		if f.value == "" {
			return row, fmt.Errorf("%s is missing", f.name)
		}
	}
	switch {
	case !setCodeFormat.MatchString(row.SetCode):
		return row, fmt.Errorf("odd set code %q", row.SetCode)
	case !langFormat.MatchString(row.Lang):
		return row, fmt.Errorf("odd language %q", row.Lang)
	case utf8.RuneCountInString(row.CollectorNumber) > maxCollectorNumber:
		return row, fmt.Errorf("collector number %q is too long", row.CollectorNumber)
	}
	if !slices.Contains(knownRarities, c.Rarity) {
		return row, fmt.Errorf("unknown rarity %q", c.Rarity)
	}
	row.Rarity = c.Rarity
	if len(c.Finishes) == 0 {
		return row, errors.New("no finishes")
	}
	for _, f := range c.Finishes {
		if !slices.Contains(knownFinishes, f) {
			return row, fmt.Errorf("unknown finish %q", f)
		}
	}
	row.Finishes = c.Finishes

	switch {
	case c.ManaCost != nil:
		row.ManaCost = *c.ManaCost
	case reversible:
		row.ManaCost = joinDistinct(c.Faces, func(f scryfall.Face) string { return f.ManaCost })
	default:
		var costs []string
		for _, f := range c.Faces {
			if f.ManaCost != "" {
				costs = append(costs, f.ManaCost)
			}
		}
		row.ManaCost = strings.Join(costs, " // ")
	}

	cmc := c.CMC
	if cmc == nil && front != nil {
		cmc = front.CMC
	}
	if cmc == nil {
		return row, errors.New("cmc is missing")
	}
	if err := row.Cmc.Scan(strconv.FormatFloat(*cmc, 'f', -1, 64)); err != nil {
		return row, fmt.Errorf("cmc: %w", err)
	}

	switch {
	case c.TypeLine != nil:
		row.TypeLine = *c.TypeLine
	case reversible:
		row.TypeLine = joinDistinct(c.Faces, func(f scryfall.Face) string { return f.TypeLine })
	case front != nil:
		row.TypeLine = front.TypeLine
	default:
		return row, errors.New("type_line is missing")
	}
	if c.OracleText != nil {
		row.OracleText = pgtype.Text{String: *c.OracleText, Valid: true}
	}

	switch {
	case c.Colors != nil:
		row.Colors = c.Colors
	default:
		for _, f := range c.Faces {
			for _, color := range f.Colors {
				if !slices.Contains(row.Colors, color) {
					row.Colors = append(row.Colors, color)
				}
			}
		}
	}
	row.Colors = nonNil(row.Colors)
	row.ColorIdentity = nonNil(c.ColorIdentity)

	imageURIs := c.ImageURIs
	if imageURIs == nil && front != nil {
		imageURIs = front.ImageURIs
	}
	// Missing images and faces are SQL NULL (not JSON null), so "IS NULL" means "none".
	if img := imagesOf(imageURIs); img != nil {
		if row.Images, err = json.Marshal(img); err != nil {
			return row, err
		}
	}
	if len(c.Faces) > 0 {
		faces := make([]storedFace, len(c.Faces))
		for i, f := range c.Faces {
			faces[i] = storedFace{Name: f.Name, ManaCost: f.ManaCost, TypeLine: f.TypeLine, Images: imagesOf(f.ImageURIs)}
			if f.OracleText != nil {
				faces[i].OracleText = *f.OracleText
			}
		}
		if row.Faces, err = json.Marshal(faces); err != nil {
			return row, err
		}
	}

	for _, p := range []struct {
		dst *pgtype.Numeric
		src *string
	}{
		{&row.PriceEur, c.Prices.EUR},
		{&row.PriceEurFoil, c.Prices.EURFoil},
		{&row.PriceUsd, c.Prices.USD},
		{&row.PriceUsdFoil, c.Prices.USDFoil},
		{&row.PriceUsdEtched, c.Prices.USDEtched},
	} {
		if p.src == nil {
			continue
		}
		// Plain decimals only: ParseFloat would also take NaN, Inf, -1 and 1e3.
		if !priceFormat.MatchString(*p.src) {
			return row, fmt.Errorf("price %q is not a price", *p.src)
		}
		if err := p.dst.Scan(*p.src); err != nil {
			return row, fmt.Errorf("price %q: %w", *p.src, err)
		}
	}

	if c.CardmarketID != nil {
		row.CardmarketID = pgtype.Int4{Int32: *c.CardmarketID, Valid: true}
	}
	if scryfall.CheckURL(c.PurchaseURIs.Cardmarket, scryfall.CardmarketHost) == nil {
		row.CardmarketUrl = pgtype.Text{String: c.PurchaseURIs.Cardmarket, Valid: true}
	}

	released, err := time.Parse(time.DateOnly, c.ReleasedAt)
	if err != nil {
		return row, fmt.Errorf("released_at: %w", err)
	}
	row.ReleasedAt = pgtype.Date{Time: released, Valid: true}

	// Postgres text and jsonb can't hold a NUL character: one would fail the whole import.
	text := []string{row.Name, row.CollectorNumber, row.Layout, row.ManaCost, row.TypeLine, row.OracleText.String}
	for _, s := range slices.Concat(text, row.Colors, row.ColorIdentity) {
		if strings.ContainsRune(s, 0) {
			return row, errors.New("text contains a NUL character")
		}
	}
	if bytes.Contains(row.Faces, []byte(`\u0000`)) {
		return row, errors.New("a face's text contains a NUL character")
	}
	return row, nil
}

// joinDistinct joins each different non-empty value of the faces' field, in order, the
// way Scryfall writes multi-face names and costs ("A // B").
func joinDistinct(faces []scryfall.Face, field func(scryfall.Face) string) string {
	var parts []string
	for _, f := range faces {
		if v := field(f); v != "" && !slices.Contains(parts, v) {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " // ")
}

// How images and faces are stored (as jsonb). The API maps them to its own contract types,
// so a change to the API's shapes doesn't change what's stored.
type storedImages struct {
	Small   string `json:"small"`
	Normal  string `json:"normal"`
	Large   string `json:"large"`
	ArtCrop string `json:"art_crop"`
}

type storedFace struct {
	Name       string        `json:"name"`
	ManaCost   string        `json:"mana_cost"`
	TypeLine   string        `json:"type_line"`
	OracleText string        `json:"oracle_text,omitempty"`
	Images     *storedImages `json:"images"`
}

// imagesOf returns the card's image URLs if all four are Scryfall image URLs, else nil
// (stored as null, and shown as a placeholder).
func imagesOf(u *scryfall.ImageURIs) *storedImages {
	if u == nil {
		return nil
	}
	for _, url := range []string{u.Small, u.Normal, u.Large, u.ArtCrop} {
		if scryfall.CheckURL(url, scryfall.ImageHost) != nil {
			return nil
		}
	}
	return &storedImages{Small: u.Small, Normal: u.Normal, Large: u.Large, ArtCrop: u.ArtCrop}
}

// setRow maps a Scryfall set to a row for the sets table.
func setRow(s scryfall.Set) (store.UpsertSetsParams, error) {
	row := store.UpsertSetsParams{Code: s.Code, Name: s.Name, SetType: s.SetType}
	if s.Name == "" || s.SetType == "" {
		return row, errors.New("name or set_type is missing")
	}
	if !setCodeFormat.MatchString(s.Code) {
		return row, fmt.Errorf("odd set code %q", s.Code)
	}
	var err error
	if row.ScryfallID, err = parseUUID(s.ID); err != nil {
		return row, fmt.Errorf("id: %w", err)
	}
	if s.ReleasedAt != "" {
		released, err := time.Parse(time.DateOnly, s.ReleasedAt)
		if err != nil {
			return row, fmt.Errorf("released_at: %w", err)
		}
		row.ReleasedAt = pgtype.Date{Time: released, Valid: true}
	}
	if scryfall.CheckURL(s.IconSVGURI, scryfall.SetIconHost) == nil {
		row.IconSvgUri = pgtype.Text{String: s.IconSVGURI, Valid: true}
	}
	if s.ParentSetCode != "" {
		row.ParentSetCode = pgtype.Text{String: s.ParentSetCode, Valid: true}
	}
	return row, nil
}

func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if s == "" {
		return u, errors.New("missing")
	}
	err := u.Scan(s)
	return u, err
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
