package apperr

import (
	"errors"
	"fmt"
	"testing"
)

func TestKindOfFindsTheErrorInTheChain(t *testing.T) {
	missing := New(NotFound, "no such %s", "entry")
	if missing.Error() != "no such entry" {
		t.Errorf("message = %q", missing.Error())
	}
	wrapped := fmt.Errorf("get: %w", missing)
	if KindOf(wrapped) != NotFound || !errors.Is(wrapped, missing) {
		t.Errorf("wrapped: kind %v, is %v", KindOf(wrapped), errors.Is(wrapped, missing))
	}
	if KindOf(errors.New("connection refused")) != 0 || KindOf(nil) != 0 {
		t.Error("an ordinary error has a kind")
	}
	if errors.Is(New(NotFound, "no such entry"), missing) {
		t.Error("two errors with the same message match: sentinels must be the same value")
	}
}
