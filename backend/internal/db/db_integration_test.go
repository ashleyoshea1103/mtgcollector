//go:build integration

package db_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/testdb"
)

func TestMigrationsCreateTheExtensions(t *testing.T) {
	pool := testdb.New(t) // migrated

	for _, ext := range []string{"pg_trgm", "citext"} {
		var schema string
		err := pool.QueryRow(t.Context(),
			`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = $1`,
			ext).Scan(&schema)
		if err != nil {
			t.Errorf("extension %s: %v", ext, err)
		} else if schema != "public" {
			t.Errorf("extension %s is in schema %q, want public (so every schema can use it)", ext, schema)
		}
	}
	// And they're usable from the migrated schema.
	var sim float32
	if err := pool.QueryRow(t.Context(), `SELECT similarity('Lightning Bolt', 'lightning bolt'::citext::text)`).Scan(&sim); err != nil {
		t.Errorf("using the extensions: %v", err)
	}
}

func TestMigrateAgainChangesNothing(t *testing.T) {
	pool := testdb.New(t)
	version := func() (v int64) {
		t.Helper()
		if err := pool.QueryRow(t.Context(), `SELECT max(version_id) FROM goose_db_version`).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	before := version()

	if err := db.Migrate(t.Context(), pool); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	if after := version(); after != before {
		t.Errorf("version changed from %d to %d", before, after)
	}
	if before < 1 {
		t.Errorf("version = %d, want the migrations applied", before)
	}
}

func TestEachTestGetsItsOwnSchema(t *testing.T) {
	a, b := testdb.New(t), testdb.New(t)
	if _, err := a.Exec(t.Context(), `CREATE TABLE only_in_a (id int)`); err != nil {
		t.Fatal(err)
	}
	var visible bool
	if err := b.QueryRow(t.Context(), `SELECT to_regclass('only_in_a') IS NOT NULL`).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible {
		t.Error("a table created in one test's schema is visible from another's")
	}
}

func TestStaleTestSchemasAreDropped(t *testing.T) {
	pool := testdb.New(t)
	// A schema left by a test run killed three hours ago, before its cleanup could run.
	stale := fmt.Sprintf("test_%d_deadbeef", time.Now().Add(-3*time.Hour).Unix())
	if _, err := pool.Exec(t.Context(), "CREATE SCHEMA "+stale); err != nil {
		t.Fatal(err)
	}

	testdb.New(t) // the next test to start sweeps it

	var exists bool
	if err := pool.QueryRow(t.Context(), `SELECT EXISTS (SELECT FROM pg_namespace WHERE nspname = $1)`, stale).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Errorf("stale schema %s is still there", stale)
	}
}
