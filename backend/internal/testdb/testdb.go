// Package testdb gives each integration test a freshly migrated database schema of
// its own, in the database TEST_DATABASE_URL points at. Tests can run in parallel,
// and nothing they write outlives them.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
)

const setupHint = "verify.sh defaults it to the local mtgcollector_test database; " +
	"run ./scripts/setup-dev-db.sh once to create it (see CONTRIBUTING.md)"

// Schemas left behind by test runs that were killed before their cleanup ran (a
// timeout, Ctrl-C) are dropped once they're this old. No test runs this long.
const staleAfter = 2 * time.Hour

// New creates an empty schema, migrates it, and returns a pool whose connections use
// it (with public, for the extensions, after it on the search_path). The schema is
// dropped when the test ends. It fails the test, never skips it, when there's no
// database: a test that silently didn't run would pass the gate.
func New(t testing.TB) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is not set; " + setupHint)
	}
	ctx := t.Context()

	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatalf("connect to TEST_DATABASE_URL: %v\n%s", err, setupHint)
	}
	t.Cleanup(func() { admin.Close(context.Background()) })

	// Tests create and drop schemas freely, so never run them against a database that
	// might hold real data, whatever TEST_DATABASE_URL says.
	var database string
	if err := admin.QueryRow(ctx, "SELECT current_database()").Scan(&database); err != nil {
		t.Fatalf("read the test database's name: %v", err)
	}
	if !strings.HasSuffix(database, "_test") {
		t.Fatalf("TEST_DATABASE_URL points at database %q; tests only run in a database whose name ends in _test", database)
	}
	dropStaleSchemas(t, admin)

	// The creation time is in the name, so stale schemas can be found; the random part
	// keeps parallel tests apart. Only digits, letters and _, so it's safe in SQL.
	schema := fmt.Sprintf("test_%d_%s", time.Now().Unix(), randomHex(t, 6))
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		// t.Context() is already cancelled when cleanups run.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema %s: %v", schema, err)
		}
	})

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db.Configure(cfg)
	cfg.MaxConns = 4 // many tests run at once; keep well inside Postgres's max_connections
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open test pool: %v", err)
	}
	t.Cleanup(pool.Close) // runs before the schema is dropped (cleanups run last-in, first-out)

	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate test schema: %v", err)
	}
	return pool
}

// dropStaleSchemas drops test schemas older than staleAfter.
func dropStaleSchemas(t testing.TB, admin *pgx.Conn) {
	t.Helper()
	cutoff := time.Now().Add(-staleAfter).Unix()
	rows, err := admin.Query(t.Context(),
		`SELECT nspname FROM pg_namespace
		  WHERE nspname ~ '^test_[0-9]{1,18}_[0-9a-f]+$' -- at most 18 digits, so the cast below can't overflow
		    AND split_part(nspname, '_', 2)::bigint < $1`, cutoff)
	if err != nil {
		t.Fatalf("list stale test schemas: %v", err)
	}
	stale, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("list stale test schemas: %v", err)
	}
	for _, schema := range stale {
		// A parallel test may be dropping the same one, so a failure here is only logged.
		if _, err := admin.Exec(t.Context(), "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Logf("drop stale test schema %s: %v", schema, err)
		}
	}
}

func randomHex(t testing.TB, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}
