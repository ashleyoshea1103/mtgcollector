package db

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgconn/ctxwatch"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open connects to the database at url (see Configure). A database on another machine must
// be reached over TLS that checks the server's certificate and name (see CheckTLS).
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if err := CheckTLS(cfg.ConnConfig.Config); err != nil {
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

// CheckTLS refuses a connection to a database on another machine unless it uses
// sslmode=verify-full: TLS that checks the server's certificate and that it's for the host
// connected to. With any other mode, something on the network between could read the
// traffic or pose as the database. A database on this machine (a loopback address, or a
// Unix socket) needs no TLS.
func CheckTLS(cfg pgconn.Config) error {
	targets := []struct {
		host string
		tls  *tls.Config
	}{{cfg.Host, cfg.TLSConfig}}
	for _, f := range cfg.Fallbacks {
		targets = append(targets, struct {
			host string
			tls  *tls.Config
		}{f.Host, f.TLSConfig})
	}
	for _, t := range targets {
		if isLocal(t.host) {
			continue
		}
		// verify-full is the only mode pgx gives a TLS config that does the standard checks.
		if t.tls == nil || t.tls.InsecureSkipVerify {
			return fmt.Errorf("the database at %s is on another machine: connect to it with sslmode=verify-full", t.host)
		}
	}
	return nil
}

func isLocal(host string) bool {
	if strings.HasPrefix(host, "/") || strings.EqualFold(host, "localhost") {
		return true // a Unix socket, or this machine
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.IsLoopback()
}
