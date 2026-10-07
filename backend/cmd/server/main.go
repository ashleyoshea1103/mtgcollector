// Command server runs the HTTP API. It applies any pending database migrations
// before it starts listening, and keeps the card data up to date by importing Scryfall's
// bulk file once a day (the first import downloads about 80 MB).
//
// Environment:
//
//	DATABASE_URL   Postgres connection URL (default: the local development database;
//	               the password comes from pgpass, see scripts/setup-dev-db.sh)
//	ADDR           address to listen on (default: 127.0.0.1:8080, where the Vite dev proxy sends /api)
//	SCRYFALL_SYNC  "daily" (the default) or "off"; `go run ./cmd/sync` imports on demand
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/api"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
)

type config struct {
	DatabaseURL string
	Addr        string
	DailySync   bool
}

const (
	defaultAddr     = "127.0.0.1:8080"
	shutdownTimeout = 10 * time.Second
	syncCheckEvery  = time.Hour // how often to check whether the daily import is due
)

func loadConfig(getenv func(string) string) (config, error) {
	cfg := config{DatabaseURL: getenv("DATABASE_URL"), Addr: getenv("ADDR")}
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = db.DefaultURL
	}
	if cfg.Addr == "" {
		cfg.Addr = defaultAddr
	}
	switch v := getenv("SCRYFALL_SYNC"); v {
	case "", "daily":
		cfg.DailySync = true
	case "off":
	default:
		return cfg, fmt.Errorf("SCRYFALL_SYNC=%q: want daily or off", v)
	}
	return cfg, nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		stop() // a second Ctrl-C during the graceful shutdown kills the process
	}()
	cfg, err := loadConfig(os.Getenv)
	if err == nil {
		err = run(ctx, cfg)
	}
	if err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config) error {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	var background sync.WaitGroup
	defer background.Wait() // before the pool closes: the import uses it
	if cfg.DailySync {
		importer := &cards.Importer{Pool: pool, Source: scryfall.New(), LockKey: cards.DefaultLockKey, Log: slog.Default()}
		background.Go(func() { importer.RunDaily(ctx, syncCheckEvery) })
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.NewHandler(pool),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", cfg.Addr)

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
