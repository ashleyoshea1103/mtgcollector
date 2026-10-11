package collection

import (
	"cmp"
	"context"
	"regexp"
	"slices"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// The groups for each way of grouping but by set, in order, with their labels. Their keys
// are what the card_group SQL function gives (migration 00005).
var fixedGroups = map[contract.GroupBy][]struct{ key, label string }{
	contract.GroupByNone: {{"all", "All cards"}},
	contract.GroupByColor: {
		{"W", "White"}, {"U", "Blue"}, {"B", "Black"}, {"R", "Red"}, {"G", "Green"}, {"M", "Multicolor"}, {"C", "Colorless"},
	},
	contract.GroupByType: {
		{"creature", "Creatures"}, {"planeswalker", "Planeswalkers"}, {"battle", "Battles"}, {"instant", "Instants"},
		{"sorcery", "Sorceries"}, {"artifact", "Artifacts"}, {"enchantment", "Enchantments"}, {"land", "Lands"},
		{"other", "Other"},
	},
	contract.GroupByRarity: {
		{"mythic", "Mythic rare"}, {"rare", "Rare"}, {"uncommon", "Uncommon"}, {"common", "Common"},
		{"special", "Special"}, {"bonus", "Bonus"},
	},
	contract.GroupByCMC: {
		{"0", "0"}, {"1", "1"}, {"2", "2"}, {"3", "3"}, {"4", "4"}, {"5", "5"}, {"6", "6"}, {"7", "7+"},
	},
}

// A set code, as Scryfall writes them: lower-case letters and digits.
var setCode = regexp.MustCompile(`^[a-z0-9]{1,8}$`)

// Groups returns the groups of the user's collection for one way of grouping (none if not
// given), in order: by set, newest set first (sets released the same day by name, those with no
// date last); otherwise in the order of fixedGroups. Groups the user has no cards in are left
// out, but for none's one group, which is always there.
func (s *Service) Groups(ctx context.Context, userID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	return s.groupsOf(ctx, userID, collectionGroup, by)
}

// collectionGroup is the listing_rows group_id of the collection itself: its entries, rather
// than a custom group's members. (Custom groups' ids start at 1.)
const collectionGroup = 0

// groupsOf groups the collection (collectionGroup) or the members of one of the user's
// custom groups.
func (s *Service) groupsOf(ctx context.Context, userID, groupID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	if by == "" {
		by = contract.GroupByNone
	}
	if err := checkEnum(by); err != nil {
		return contract.CollectionGroups{}, invalid("%s", err)
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	rows, err := s.q().GroupTotals(ctx, store.GroupTotalsParams{UserID: userID, GroupID: groupID, GroupBy: string(by)})
	if err != nil {
		return contract.CollectionGroups{}, db.Error(ctx, "group collection", err)
	}
	totals := map[string]store.GroupTotalsRow{}
	for _, r := range rows {
		totals[r.Key] = r
	}
	groups := []contract.GroupSummary{}
	if by == contract.GroupByNone && len(rows) == 0 {
		// The one group is always there, so an empty collection (or custom group) still shows
		// its (zero) totals.
		totals["all"] = store.GroupTotalsRow{Key: "all"}
	}
	if by == contract.GroupBySet {
		groups, err = s.setGroups(ctx, totals)
		if err != nil {
			return contract.CollectionGroups{}, err
		}
	}
	for _, g := range fixedGroups[by] {
		if r, ok := totals[g.key]; ok {
			groups = append(groups, summary(r, g.label, nil))
		}
	}
	return contract.CollectionGroups{GroupBy: by, Groups: groups}, nil
}

func (s *Service) setGroups(ctx context.Context, totals map[string]store.GroupTotalsRow) ([]contract.GroupSummary, error) {
	codes := make([]string, 0, len(totals))
	for code := range totals {
		codes = append(codes, code)
	}
	sets, err := s.q().SetsByCode(ctx, codes)
	if err != nil {
		return nil, db.Error(ctx, "find sets", err)
	}
	slices.SortFunc(sets, func(a, b store.SetsByCodeRow) int {
		return cmp.Or(b.ReleasedAt.Time.Compare(a.ReleasedAt.Time), cmp.Compare(a.Name, b.Name))
	})
	groups := make([]contract.GroupSummary, len(sets))
	for i, set := range sets {
		var icon *string
		if set.IconSvgUri.Valid {
			icon = &set.IconSvgUri.String
		}
		groups[i] = summary(totals[set.Code], set.Name, &contract.CardSet{Code: set.Code, Name: set.Name, IconSVGURI: icon})
	}
	return groups, nil
}

func summary(r store.GroupTotalsRow, label string, set *contract.CardSet) contract.GroupSummary {
	return contract.GroupSummary{
		ValueTotal: valueTotal(r), Key: r.Key, Label: label, Set: set, EntryCount: int(r.EntryCount),
	}
}

func valueTotal(r store.GroupTotalsRow) contract.ValueTotal {
	t := contract.ValueTotal{CardCount: int(r.CardCount), UnpricedCount: int(r.UnpricedCount)}
	if v := cards.Number(r.ValueEur); v != nil {
		t.ValueEUR = *v
	}
	return t
}

// EntryQuery is which entries to read: one group's (Key, for GroupBy; none for every entry),
// in an order, from where a page's Cursor says the last page ended.
type EntryQuery struct {
	GroupBy contract.GroupBy
	Key     string
	Sort    contract.SortBy
	Cursor  string
	// The collection (collectionGroup) or a custom group, set by Entries or Members.
	group int64
}

// Entries returns a page of one group's entries.
func (s *Service) Entries(ctx context.Context, userID int64, q EntryQuery) (contract.EntryPage, error) {
	q.group = collectionGroup
	rows, next, err := s.listing(ctx, userID, q)
	if err != nil {
		return contract.EntryPage{}, err
	}
	page := contract.EntryPage{Entries: make([]contract.CollectionEntry, len(rows)), NextCursor: next}
	for i, r := range rows {
		if page.Entries[i], err = toEntry(r.ListingRow, r.CardListing); err != nil {
			return contract.EntryPage{}, err
		}
	}
	return page, nil
}

// listing reads a page of q's listing: its rows, and the cursor for the next page if there is one.
func (s *Service) listing(ctx context.Context, userID int64, q EntryQuery) ([]store.EntriesByNameRow, *string, error) {
	if q.GroupBy == "" {
		q.GroupBy = contract.GroupByNone
	}
	if q.Sort == "" {
		q.Sort = contract.SortByName
	}
	if err := checkEnum(q.GroupBy); err != nil {
		return nil, nil, invalid("%s", err)
	}
	if err := checkEnum(q.Sort); err != nil {
		return nil, nil, invalid("%s", err)
	}
	if err := checkKey(&q); err != nil {
		return nil, nil, err
	}
	var after *cursor
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor, q)
		if err != nil {
			return nil, nil, err
		}
		after = &c
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	rows, err := s.page(ctx, userID, q, after)
	if err != nil {
		return nil, nil, db.Error(ctx, "list entries", err)
	}
	if len(rows) <= PageSize {
		return rows, nil, nil
	}
	next := cursorAfter(q, rows[PageSize-1].ListingRow).encode()
	return rows[:PageSize], &next, nil
}

// checkKey checks a group key is one grouping by q.GroupBy gives, so only such keys reach the
// database. Grouping by none has the one group, all.
func checkKey(q *EntryQuery) error {
	if q.GroupBy == contract.GroupByNone {
		if q.Key != "" && q.Key != "all" {
			return invalid("key must be all, or left out, when group_by is none")
		}
		q.Key = "all"
		return nil
	}
	if q.Key == "" {
		return invalid("give the key of the group whose entries to list")
	}
	if q.GroupBy == contract.GroupBySet {
		if !setCode.MatchString(q.Key) {
			return invalid("key must be a set code, like mh2")
		}
		return nil
	}
	for _, g := range fixedGroups[q.GroupBy] {
		if g.key == q.Key {
			return nil
		}
	}
	return invalid("%s isn't a group when grouping by %s", strconv.Quote(q.Key), q.GroupBy)
}

// page runs the query for q's order, for one page and a row more (which says there's a
// next page).
func (s *Service) page(ctx context.Context, userID int64, q EntryQuery, after *cursor) ([]store.EntriesByNameRow, error) {
	limit := int32(PageSize + 1)
	var c cursor
	if after != nil {
		c = *after
	}
	afterID := pgtype.Int8{Int64: c.ID, Valid: after != nil}
	switch q.Sort {
	case contract.SortByPrice:
		rows, err := s.q().EntriesByPrice(ctx, store.EntriesByPriceParams{
			UserID: userID, GroupID: q.group, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterUnpriced: pgtype.Bool{Bool: c.Unpriced, Valid: after != nil}, AfterPrice: c.Price,
		})
		return sameRows(rows, err)
	case contract.SortByCMC:
		rows, err := s.q().EntriesByCMC(ctx, store.EntriesByCMCParams{
			UserID: userID, GroupID: q.group, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterCmc: c.CMC, AfterName: pgtype.Text{String: c.Name, Valid: after != nil},
		})
		return sameRows(rows, err)
	case contract.SortByAdded:
		rows, err := s.q().EntriesByAdded(ctx, store.EntriesByAddedParams{
			UserID: userID, GroupID: q.group, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterAdded: pgtype.Timestamptz{Time: c.Added, Valid: after != nil},
		})
		return sameRows(rows, err)
	default:
		return s.q().EntriesByName(ctx, store.EntriesByNameParams{
			UserID: userID, GroupID: q.group, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterName: pgtype.Text{String: c.Name, Valid: after != nil},
		})
	}
}

// sameRows gives every order's rows one type: each is a listed entry and its card.
func sameRows[R ~struct {
	ListingRow  store.ListingRow
	CardListing store.CardListing
}](rows []R, err error) ([]store.EntriesByNameRow, error) {
	out := make([]store.EntriesByNameRow, len(rows))
	for i, r := range rows {
		out[i] = store.EntriesByNameRow(r)
	}
	return out, err
}

// Stats returns totals for the user's whole collection.
func (s *Service) Stats(ctx context.Context, userID int64) (contract.CollectionStats, error) {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	rows, err := s.q().CollectionStats(ctx, userID)
	if err != nil {
		return contract.CollectionStats{}, db.Error(ctx, "collection totals", err)
	}
	stats := contract.CollectionStats{ByColor: map[string]int{}, ByRarity: map[contract.Rarity]int{}}
	for _, r := range rows {
		switch r.TotalsOf { // which of colour and rarity the row's totals are over all of
		case 3:
			stats.ValueTotal = contract.ValueTotal{CardCount: int(r.CardCount), UnpricedCount: int(r.UnpricedCount)}
			if v := cards.Number(r.ValueEur); v != nil {
				stats.ValueEUR = *v
			}
			stats.UniqueCards = int(r.UniqueCards)
		case 1:
			stats.ByColor[r.Color] = int(r.CardCount)
		case 2:
			stats.ByRarity[contract.Rarity(r.Rarity)] = int(r.CardCount)
		}
	}
	return stats, nil
}
