package collection

import (
	"fmt"
	"hash/fnv"
	"slices"
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

var curlyApostrophes = strings.NewReplacer("‘", "'", "’", "'", "ʼ", "'")

// parseSearch reads a search, refusing one the database couldn't run: longer than any card's
// name or type, not UTF-8, or with a NUL (which Postgres text can't hold).
func parseSearch(q string) (search, error) {
	if utf8.RuneCountInString(q) > contract.MaxSearchLength {
		return search{}, invalid("a search can be at most %d characters", contract.MaxSearchLength)
	}
	if !utf8.ValidString(q) {
		return search{}, invalid("a search must be UTF-8 text")
	}
	if strings.ContainsRune(q, 0) {
		return search{}, invalid("a search can't contain the character NUL")
	}
	// Card names and type lines use straight apostrophes, which phones often type curly.
	q = curlyApostrophes.Replace(q)
	// A dash on its own is the one between a type line's types ("Creature — Goblin"): as a word,
	// typed as a hyphen, it would find nothing.
	words := slices.DeleteFunc(strings.Fields(q), func(w string) bool { return strings.Trim(w, "-–—") == "" })
	s := search{patterns: cards.ContainsEach(words)}
	if len(words) > 0 {
		h := fnv.New64a()
		h.Write([]byte(strings.Join(words, " ")))
		s.digest = fmt.Sprintf("%016x", h.Sum64())
	}
	return s, nil
}
