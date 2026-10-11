package contract

type Finish string

const (
	FinishNonfoil Finish = "nonfoil"
	FinishFoil    Finish = "foil"
	FinishEtched  Finish = "etched"
)

// Cardmarket grading scale, best to worst.
type Condition string

const (
	ConditionMT Condition = "MT"
	ConditionNM Condition = "NM"
	ConditionEX Condition = "EX"
	ConditionGD Condition = "GD"
	ConditionLP Condition = "LP"
	ConditionPL Condition = "PL"
	ConditionPO Condition = "PO"
)

// The languages Scryfall prints cards in (https://scryfall.com/docs/api/languages).
type Language string

const (
	LanguageEnglish            Language = "en"
	LanguageGerman             Language = "de"
	LanguageFrench             Language = "fr"
	LanguageItalian            Language = "it"
	LanguageSpanish            Language = "es"
	LanguagePortuguese         Language = "pt"
	LanguageJapanese           Language = "ja"
	LanguageKorean             Language = "ko"
	LanguageRussian            Language = "ru"
	LanguageSimplifiedChinese  Language = "zhs"
	LanguageTraditionalChinese Language = "zht"
	LanguageHebrew             Language = "he"
	LanguageLatin              Language = "la"
	LanguageAncientGreek       Language = "grc"
	LanguageArabic             Language = "ar"
	LanguageSanskrit           Language = "sa"
	LanguagePhyrexian          Language = "ph"
	LanguageQuenya             Language = "qya"
)

type Rarity string

const (
	RarityCommon   Rarity = "common"
	RarityUncommon Rarity = "uncommon"
	RarityRare     Rarity = "rare"
	RarityMythic   Rarity = "mythic"
	RaritySpecial  Rarity = "special"
	RarityBonus    Rarity = "bonus"
)

type ImageSize string

const (
	ImageSizeSmall   ImageSize = "small"
	ImageSizeNormal  ImageSize = "normal"
	ImageSizeLarge   ImageSize = "large"
	ImageSizeArtCrop ImageSize = "art_crop"
)

// Scryfall image URLs, one per ImageSize.
type CardImages struct {
	Small   string `json:"small"`
	Normal  string `json:"normal"`
	Large   string `json:"large"`
	ArtCrop string `json:"art_crop"`
}

type CardFace struct {
	Name       string `json:"name"`
	ManaCost   string `json:"mana_cost"`
	TypeLine   string `json:"type_line"`
	OracleText string `json:"oracle_text,omitempty"`
	// Only set for cards whose faces are printed on separate sides (transform, modal DFC, reversible).
	Images *CardImages `json:"images" tstype:"CardImages | null,required"`
}

// Scryfall's prices. EUR comes from Cardmarket. Scryfall has no EUR etched price:
// etched copies use the EUR foil price when the printing has one, and etched-only
// printings usually have no EUR price at all (so they count as unpriced).
type Prices struct {
	EUR       *float64 `json:"eur" tstype:"number | null,required"`
	EURFoil   *float64 `json:"eur_foil" tstype:"number | null,required"`
	USD       *float64 `json:"usd" tstype:"number | null,required"`
	USDFoil   *float64 `json:"usd_foil" tstype:"number | null,required"`
	USDEtched *float64 `json:"usd_etched" tstype:"number | null,required"`
}

// The set a printing belongs to: with the collector number, it says exactly which
// printing of a card someone owns.
type CardSet struct {
	// Scryfall's set code, e.g. "mh2".
	Code string `json:"code"`
	Name string `json:"name"`
	// The set's symbol: an SVG on svgs.scryfall.io, or null. Only ever draw it as an image
	// (an <img> or a CSS mask), which doesn't run scripts inside an SVG: never inline it.
	IconSVGURI *string `json:"icon_svg_uri" tstype:"string | null,required"`
}

// The fields list views need (search results, collection entries).
type CardSummary struct {
	ID              string  `json:"id"`
	OracleID        string  `json:"oracle_id"`
	Name            string  `json:"name"`
	Set             CardSet `json:"set"`
	CollectorNumber string  `json:"collector_number"`
	Rarity          Rarity  `json:"rarity"`
	// Scryfall language code of this printing, e.g. "en", "ja".
	Lang          string   `json:"lang"`
	ManaCost      string   `json:"mana_cost"`
	CMC           float64  `json:"cmc"`
	TypeLine      string   `json:"type_line"`
	Colors        []string `json:"colors"`
	ColorIdentity []string `json:"color_identity"`
	// Front image; for double-faced cards this is the first face.
	Images *CardImages `json:"images" tstype:"CardImages | null,required"`
	Prices Prices      `json:"prices"`
	// Finishes this printing exists in.
	Finishes   []Finish `json:"finishes"`
	ReleasedAt string   `json:"released_at"`
	// Scryfall no longer lists this printing (deleted, merged or made digital-only). It's
	// kept because collections may hold it, but it has no prices and isn't in search results.
	NoLongerListed bool `json:"no_longer_listed"`
}

// One page of cards: search results (one printing per card) or one card's printings.
type CardPage struct {
	Cards []CardSummary `json:"cards"`
	// This page's number, from 1.
	Page int `json:"page"`
	// Whether there's a next page.
	HasMore bool `json:"has_more"`
}

// GET /api/cards/autocomplete: card names matching what's been typed, best first.
type CardNames struct {
	Names []string `json:"names"`
}

// The body of every 4xx and 5xx API response.
type APIError struct {
	// What went wrong, safe to show: never internal details.
	Error string `json:"error"`
}

// One Scryfall printing with everything the detail view shows.
type Card struct {
	CardSummary   `tstype:",extends"`
	Faces         []CardFace `json:"faces" tstype:"CardFace[] | null,required"`
	OracleText    *string    `json:"oracle_text" tstype:"string | null,required"`
	CardmarketURL *string    `json:"cardmarket_url" tstype:"string | null,required"`
}

// A card the user owns: one printing in one finish, condition and language.
type CollectionEntry struct {
	ID        int64       `json:"id"`
	Card      CardSummary `json:"card"`
	Quantity  int         `json:"quantity"`
	Finish    Finish      `json:"finish"`
	Condition Condition   `json:"condition"`
	Language  Language    `json:"language"`
	AddedAt   string      `json:"added_at"`
	// EUR price of one copy in this finish, set by the server; null when there's no price.
	UnitPriceEUR *float64 `json:"unit_price_eur" tstype:"number | null,required"`
	// quantity × unit_price_eur; null when there's no price.
	ValueEUR *float64 `json:"value_eur" tstype:"number | null,required"`
}

// A total over many cards, some of which may have no price.
type ValueTotal struct {
	// Number of cards (copies) counted.
	CardCount int `json:"card_count"`
	// Sum over the priced cards only.
	ValueEUR float64 `json:"value_eur"`
	// How many of the cards had no EUR price and are left out of value_eur.
	UnpricedCount int `json:"unpriced_count"`
}

type GroupBy string

const (
	GroupByNone   GroupBy = "none"
	GroupBySet    GroupBy = "set"
	GroupByColor  GroupBy = "color"
	GroupByType   GroupBy = "type"
	GroupByRarity GroupBy = "rarity"
	GroupByCMC    GroupBy = "cmc"
)

type SortBy string

const (
	SortByName  SortBy = "name"
	SortByPrice SortBy = "price"
	SortByCMC   SortBy = "cmc"
	SortByAdded SortBy = "added"
)

// The header of one auto-group (e.g. "Red", "Modern Horizons 2"). Its entries
// are fetched separately, a page at a time, as an EntryPage.
type GroupSummary struct {
	ValueTotal `tstype:",extends"`
	Key        string `json:"key"`
	Label      string `json:"label"`
	// The set, when grouping by set (so the header can show its symbol); null otherwise.
	Set *CardSet `json:"set" tstype:"CardSet | null,required"`
	// Number of collection entries (distinct printing/finish/condition/language rows).
	EntryCount int `json:"entry_count"`
}

// GET /api/collection/groups: the collection's groups, in order, for one way of grouping.
type CollectionGroups struct {
	GroupBy GroupBy        `json:"group_by"`
	Groups  []GroupSummary `json:"groups"`
}

// One page of collection entries; pass next_cursor back to get the next page.
type EntryPage struct {
	Entries    []CollectionEntry `json:"entries"`
	NextCursor *string           `json:"next_cursor" tstype:"string | null,required"`
}

// A collection entry as a member of a custom group. A binder can hold only some
// of an entry's copies, so the member has its own quantity and value.
type GroupMember struct {
	Entry CollectionEntry `json:"entry"`
	// Copies of the entry in this group: 1 to entry.quantity.
	Quantity int `json:"quantity"`
	// quantity × entry.unit_price_eur; null when there's no price.
	ValueEUR *float64 `json:"value_eur" tstype:"number | null,required"`
	// When it joined the group (RFC 3339, UTC).
	AddedAt string `json:"added_at"`
}

// One page of a custom group's members.
type GroupMemberPage struct {
	Members    []GroupMember `json:"members"`
	NextCursor *string       `json:"next_cursor" tstype:"string | null,required"`
}

type CustomGroupKind string

const (
	CustomGroupKindBinder CustomGroupKind = "binder"
	CustomGroupKindDeck   CustomGroupKind = "deck"
	CustomGroupKindBox    CustomGroupKind = "box"
	CustomGroupKindOther  CustomGroupKind = "other"
)

// A user-created group of cards: a binder, deck, box, etc.
type CustomGroup struct {
	ValueTotal    `tstype:",extends"`
	ID            int64           `json:"id"`
	Name          string          `json:"name"`
	Kind          CustomGroupKind `json:"kind"`
	Description   string          `json:"description"`
	PreviewImages []string        `json:"preview_images"`
}

// GET /api/groups: the user's custom groups, by name.
type CustomGroupList struct {
	Groups []CustomGroup `json:"groups"`
}

// POST /api/groups: a new custom group.
type NewGroup struct {
	Name        string          `json:"name"`
	Kind        CustomGroupKind `json:"kind"`
	Description string          `json:"description"`
}

// PATCH /api/groups/{id}: what to change about a group. Leave out what stays.
type GroupChange struct {
	Name        *string          `json:"name,omitempty"`
	Kind        *CustomGroupKind `json:"kind,omitempty"`
	Description *string          `json:"description,omitempty"`
}

// PUT /api/groups/{id}/members/{entry_id}: how many of the entry's copies are in the group.
type MemberQuantity struct {
	Quantity int `json:"quantity"`
}

// The longest a group's name and description can be, in characters: Unicode code points, after
// trimming and NFC normalisation. (In JavaScript, count [...s].length, not s.length, which
// counts UTF-16 units.)
const MaxGroupNameLength = 100

const MaxGroupDescriptionLength = 1000

// The most custom groups one user can have.
const MaxGroups = 500

// The most group members (an entry in a group) one user can have, over all their groups: it
// bounds the work of listing the groups, which totals every member.
const MaxMembers = 100_000

// Totals for the whole collection. Values are EUR only: Cardmarket is the reference market.
type CollectionStats struct {
	ValueTotal `tstype:",extends"`
	// Distinct printings owned (entries for the same printing in other finishes/conditions count once).
	UniqueCards int            `json:"unique_cards"`
	ByColor     map[string]int `json:"by_color"`
	ByRarity    map[Rarity]int `json:"by_rarity" tstype:"{ [R in Rarity]?: number }"`
}

type HealthStatus string

const (
	HealthStatusOK          HealthStatus = "ok"
	HealthStatusUnavailable HealthStatus = "unavailable"
)

// GET /api/health: whether the server can reach its database.
type Health struct {
	Status HealthStatus `json:"status"`
}

// What the add-to-collection form submits.
type NewEntry struct {
	CardID    string    `json:"card_id"`
	Quantity  int       `json:"quantity"`
	Finish    Finish    `json:"finish"`
	Condition Condition `json:"condition"`
	Language  Language  `json:"language"`
	GroupID   *int64    `json:"group_id" tstype:"number | null,required"`
}

// PATCH /api/collection/entries/{id}: what to change about an entry. Leave out what stays.
type EntryChange struct {
	Quantity  *int       `json:"quantity,omitempty"`
	Finish    *Finish    `json:"finish,omitempty"`
	Condition *Condition `json:"condition,omitempty"`
	Language  *Language  `json:"language,omitempty"`
}

// The most copies one entry can hold.
const MaxQuantity = 999

// The most entries one collection can hold: plenty for a collection, and it bounds the work
// of every listing, which reads the whole collection.
const MaxEntries = 50_000

// The signed-in user: GET /api/auth/me, and the reply to signing up or logging in.
type User struct {
	ID    int64  `json:"id"`
	Email string `json:"email"`
}

// What the sign-up and log-in forms submit.
type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// The fewest characters a password may have: NIST SP 800-63B's minimum for a password that
// is the only sign-in factor. Long passphrases are welcome.
const MinPasswordLength = 15

// The most characters a password may have.
const MaxPasswordLength = 256
