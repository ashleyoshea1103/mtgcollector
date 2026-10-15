package collection

import (
	"fmt"
	"hash/fnv"
	"strings"
	"unicode/utf8"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/contract"
)

// search is a listing's search (?q=), as parsed: an entry matches when every word is in its
// card's name or type line, ignoring case.
type search struct {
	// An ILIKE pattern for each word; none matches every entry.
	patterns []string
	// The words' digest, which cursors carry so one is only used for its own search; "" for none.
	digest string
}

// parseSearch reads a search, refusing one the database couldn't run: longer than any card's
// name or type, or with a NUL (which Postgres text can't hold).
func parseSearch(q string) (search, error) {
	if utf8.RuneCountInString(q) > contract.MaxSearchLength {
		return search{}, invalid("a search can be at most %d characters", contract.MaxSearchLength)
	}
	if strings.ContainsRune(q, 0) {
		return search{}, invalid("a search can't contain the character NUL")
	}
	words := strings.Fields(q)
	s := search{patterns: cards.ContainsEach(words)}
	if len(words) > 0 {
		h := fnv.New64a()
		h.Write([]byte(strings.Join(words, " ")))
		s.digest = fmt.Sprintf("%016x", h.Sum64())
	}
	return s, nil
}
