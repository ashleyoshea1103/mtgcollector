// Command sync imports Scryfall's bulk card data into the database once, then exits.
// The server does the same every day by itself; use this to import straight away.
//
// Usage: go run ./cmd/sync [-force]
//
//	-force  import even if the bulk file hasn't changed since the last import
//
// DATABASE_URL works as it does for the server.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
)

func main() {
	force := flag.Bool("force", false, "import even if the bulk file hasn't changed since the last import")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *force); err != nil {
		slog.Error("import failed", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, force bool) error {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = db.DefaultURL
	}
	pool, err := db.Open(ctx, url)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	importer := &cards.Importer{Pool: pool, Source: scryfall.New(), LockKey: cards.DefaultLockKey, Log: slog.Default()}
	_, err = importer.Run(ctx, force)
	return err
}
