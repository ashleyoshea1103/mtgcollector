package db

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestDatabasesElsewhereNeedVerifiedTLS(t *testing.T) {
	for url, ok := range map[string]bool{
		DefaultURL:                                           true,
		"postgres://u@127.0.0.1:5432/db":                     true,
		"postgres://u@[::1]:5432/db":                         true,
		"postgres://u@localhost/db?sslmode=disable":          true,
		"host=/var/run/postgresql user=u dbname=db":          true,
		"postgres://u@db.example.com/db?sslmode=verify-full": true,
		"postgres://u@db.example.com/db":                     false, // prefer: falls back to no TLS
		"postgres://u@db.example.com/db?sslmode=disable":     false,
		"postgres://u@db.example.com/db?sslmode=require":     false, // no certificate check
		"postgres://u@db.example.com/db?sslmode=verify-ca":   false, // no name check
		"postgres://u@192.0.2.10/db?sslmode=require":         false,
		"postgres://u@localhost,db.example.com/db":           false, // the second host is elsewhere
		"postgres://u@localhost.example.com/db":              false,
	} {
		cfg, err := pgconn.ParseConfig(url)
		if err != nil {
			t.Fatalf("%s: %v", url, err)
		}
		err = CheckTLS(*cfg)
		if ok && err != nil || !ok && (err == nil || !strings.Contains(err.Error(), "sslmode=verify-full")) {
			t.Errorf("%s: CheckTLS = %v, want ok %v", url, err, ok)
		}
	}
}
