package db

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// pgx cancels a query whose context ends, and gets back Postgres's "canceling statement"
// error, which doesn't say why; Error adds the context's reason.
func TestErrorSaysWhyAQueryWasCancelled(t *testing.T) {
	canceled := &pgconn.PgError{Code: "57014", Message: "canceling statement due to user request"}

	expired, cancel := context.WithTimeout(t.Context(), 0)
	defer cancel()
	<-expired.Done()
	if err := Error(expired, "search", canceled); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("timed out: %v doesn't say so", err)
	}

	gone, cancel := context.WithCancel(t.Context())
	cancel()
	if err := Error(gone, "search", canceled); !errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("caller went away: %v", err)
	}

	if err := Error(t.Context(), "search", canceled); errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("context still live: %v blames it", err)
	}
	var pg *pgconn.PgError
	if err := Error(expired, "search", canceled); !errors.As(err, &pg) {
		t.Errorf("the database's error is lost: %v", err)
	}
	if err := Error(gone, "search", context.Canceled); err.Error() != "search: context canceled" {
		t.Errorf("an error that already is the context's = %q, want it once", err)
	}
}
