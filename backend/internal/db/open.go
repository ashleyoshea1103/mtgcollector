package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgconn/ctxwatch"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open connects to the database at url (see Configure).
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	Configure(cfg)
	return pgxpool.NewWithConfig(ctx, cfg)
}

// Configure sets how the app's connections behave. When a query's context is cancelled,
// the server is asked to cancel the query, and the connection is only dropped if that
// doesn't work within a second. pgx's default drops the connection straight away, which
// leaves the query (and any locks it holds) running on the server until it finishes.
func Configure(cfg *pgxpool.Config) {
	cfg.ConnConfig.BuildContextWatcherHandler = func(conn *pgconn.PgConn) ctxwatch.Handler {
		return &pgconn.CancelRequestContextWatcherHandler{Conn: conn, DeadlineDelay: time.Second}
	}
}
