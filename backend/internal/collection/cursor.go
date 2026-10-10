package collection

import (
	"encoding/base64"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
)

// cursorVersion is in every cursor, so one made by an older server is refused (as a bad
// request) rather than misread.
const cursorVersion = 1

// The longest cursor accepted: well above any this server makes.
const maxCursorLength = 1024

// cursor says where a page ended: the listing it's for, and the last entry's sort key. It
// goes to the client as opaque base64; what comes back is only ever used as query
// parameters, alongside the user's own id, so a forged one can only page the user's own
// entries differently.
type cursor struct {
	Version int              `json:"v"`
	GroupBy contract.GroupBy `json:"g"`
	Key     string           `json:"k"`
	Sort    contract.SortBy  `json:"s"`
	ID      int64            `json:"id"`
	// The last entry's sort key: what its listing's order uses.
	Name     string         `json:"name,omitempty"`
	Unpriced bool           `json:"unpriced,omitempty"`
	Price    pgtype.Numeric `json:"price"`
	CMC      pgtype.Numeric `json:"cmc"`
	Added    time.Time      `json:"added,omitzero"`
}

// cursorAfter is the cursor for the page after the one ending with r.
func cursorAfter(q EntryQuery, r store.EntriesByNameRow) cursor {
	c := cursor{Version: cursorVersion, GroupBy: q.GroupBy, Key: q.Key, Sort: q.Sort, ID: r.ID}
	switch q.Sort {
	case contract.SortByPrice:
		c.Unpriced, c.Price = !r.UnitPrice.Valid, r.UnitPrice
	case contract.SortByCMC:
		c.CMC, c.Name = r.CardListing.Cmc, r.CardListing.Name
	case contract.SortByAdded:
		c.Added = r.AddedAt.Time
	default:
		c.Name = r.CardListing.Name
	}
	return c
}

func (c cursor) encode() string {
	b, _ := json.Marshal(c) // only strings, numbers and times
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor reads a cursor from the client, and checks it's for the listing asked for.
func decodeCursor(s string, q EntryQuery) (cursor, error) {
	bad := invalid("that cursor isn't one this listing gave; start again from the first page")
	if len(s) > maxCursorLength {
		return cursor{}, bad
	}
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	if err != nil {
		return cursor{}, bad
	}
	var c cursor
	if err := json.Unmarshal(b, &c); err != nil {
		return cursor{}, bad
	}
	if c.Version != cursorVersion || c.GroupBy != q.GroupBy || c.Key != q.Key || c.Sort != q.Sort {
		return cursor{}, bad
	}
	// The sort key the order needs must be there (a price may be null: unpriced).
	switch q.Sort {
	case contract.SortByPrice:
		if c.Unpriced == c.Price.Valid {
			return cursor{}, bad
		}
	case contract.SortByCMC:
		if !c.CMC.Valid {
			return cursor{}, bad
		}
	case contract.SortByAdded:
		if c.Added.IsZero() {
			return cursor{}, bad
		}
	}
	return c, nil
}
