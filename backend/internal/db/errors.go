package db

import (
	"context"
	"errors"
	"fmt"
)

// Error wraps a failed query's error, and, if the query's context had ended, the context's
// error too. pgx cancels a query whose context ends, and what comes back is then Postgres's
// "canceling statement" error, which doesn't say why: this way callers can tell a timeout
// (context.DeadlineExceeded) from a caller that went away (context.Canceled).
func Error(ctx context.Context, what string, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil && !errors.Is(err, ctxErr) {
		return fmt.Errorf("%s: %w (%w)", what, ctxErr, err)
	}
	return fmt.Errorf("%s: %w", what, err)
}
