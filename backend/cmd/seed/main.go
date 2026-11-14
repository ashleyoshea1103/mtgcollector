// Command seed fills the development database with an account and a collection to look at,
// replacing what it made last time. It needs the card data imported first (go run ./cmd/sync),
// and refuses any database but the development one.
//
// Usage: go run ./cmd/seed
//
// DATABASE_URL works as it does for the server. Log in as the email and password it prints.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/seed"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("seed failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = db.DefaultURL
	}
	pool, err := db.Open(ctx, url)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	if err := seed.CheckDatabase(ctx, pool); err != nil {
		return err
	}
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	res, err := seed.Run(ctx, pool, slog.Default())
	if err != nil {
		return err
	}
	fmt.Printf("Seeded %d collection entries and %d groups.\n", res.Entries, res.Groups)
	if len(res.Missing) > 0 {
		fmt.Printf("Left out %d cards the database doesn't have: %s\n", len(res.Missing), strings.Join(res.Missing, "; "))
	}
	fmt.Printf("Log in as %s with the password %q.\n", seed.Email, seed.Password)
	return nil
}
