// Package testdb gives each integration test a freshly migrated database schema of
// its own, in the database TEST_DATABASE_URL points at. Tests can run in parallel,
// and nothing they write outlives them.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/db"
)

const setupHint = "verify.sh defaults it to the local mtgcollector_test database; " +
	"run ./scripts/setup-dev-db.sh once to create it (see CONTRIBUTING.md)"

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
	schema := "test_" + randomHex(t, 8) // only hex digits, so it's safe to put in SQL
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close(ctx)
		t.Fatalf("create test schema: %v", err)
	}
	t.Cleanup(func() {
		// t.Context() is already cancelled when cleanups run.
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("drop test schema %s: %v", schema, err)
		}
		admin.Close(ctx)
	})

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
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

func randomHex(t testing.TB, n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}
