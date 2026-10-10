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

// Groups returns the user's groups for one way of grouping, in order: by set, newest set
// first; otherwise in the order of fixedGroups. Groups the user has no cards in are left out.
func (s *Service) Groups(ctx context.Context, userID int64, by contract.GroupBy) (contract.CollectionGroups, error) {
	if err := checkEnum(by); err != nil {
		return contract.CollectionGroups{}, invalid("%s", err)
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	rows, err := s.Q.GroupTotals(ctx, store.GroupTotalsParams{UserID: userID, GroupBy: string(by)})
	if err != nil {
		return contract.CollectionGroups{}, db.Error(ctx, "group collection", err)
	}
	totals := map[string]store.GroupTotalsRow{}
	for _, r := range rows {
		totals[r.Key] = r
	}
	groups := []contract.GroupSummary{}
	if by == contract.GroupByNone && len(rows) == 0 {
		// The one group is always there, so an empty collection still shows its (zero) totals.
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
	sets, err := s.Q.SetsByCode(ctx, codes)
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
}

// Entries returns a page of one group's entries.
func (s *Service) Entries(ctx context.Context, userID int64, q EntryQuery) (contract.EntryPage, error) {
	if q.GroupBy == "" {
		q.GroupBy = contract.GroupByNone
	}
	if q.Sort == "" {
		q.Sort = contract.SortByName
	}
	if err := checkEnum(q.GroupBy); err != nil {
		return contract.EntryPage{}, invalid("%s", err)
	}
	if err := checkEnum(q.Sort); err != nil {
		return contract.EntryPage{}, invalid("%s", err)
	}
	if err := checkKey(&q); err != nil {
		return contract.EntryPage{}, err
	}
	var after *cursor
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor, q)
		if err != nil {
			return contract.EntryPage{}, err
		}
		after = &c
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	rows, err := s.page(ctx, userID, q, after)
	if err != nil {
		return contract.EntryPage{}, db.Error(ctx, "list entries", err)
	}
	page := contract.EntryPage{Entries: make([]contract.CollectionEntry, 0, min(len(rows), PageSize))}
	for i, r := range rows {
		if i == PageSize {
			next := cursorAfter(q, rows[i-1].EntryPrice).encode()
			page.NextCursor = &next
			break
		}
		e, err := toEntry(r.EntryPrice, r.CardListing)
		if err != nil {
			return contract.EntryPage{}, err
		}
		page.Entries = append(page.Entries, e)
	}
	return page, nil
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
		rows, err := s.Q.EntriesByPrice(ctx, store.EntriesByPriceParams{
			UserID: userID, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterUnpriced: pgtype.Bool{Bool: c.Unpriced, Valid: after != nil}, AfterPrice: c.Price,
		})
		return sameRows(rows, err)
	case contract.SortByCMC:
		rows, err := s.Q.EntriesByCMC(ctx, store.EntriesByCMCParams{
			UserID: userID, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterCmc: c.CMC, AfterName: pgtype.Text{String: c.Name, Valid: after != nil},
		})
		return sameRows(rows, err)
	case contract.SortByAdded:
		rows, err := s.Q.EntriesByAdded(ctx, store.EntriesByAddedParams{
			UserID: userID, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterAdded: pgtype.Timestamptz{Time: c.Added, Valid: after != nil},
		})
		return sameRows(rows, err)
	default:
		return s.Q.EntriesByName(ctx, store.EntriesByNameParams{
			UserID: userID, GroupBy: string(q.GroupBy), GroupKey: q.Key, RowLimit: limit, AfterID: afterID,
			AfterName: pgtype.Text{String: c.Name, Valid: after != nil},
		})
	}
}

// sameRows gives every order's rows one type: each is an entry and its card.
func sameRows[R ~struct {
	EntryPrice  store.EntryPrice
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
	rows, err := s.Q.CollectionStats(ctx, userID)
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
