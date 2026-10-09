// Command server runs the HTTP API. It applies any pending database migrations
// before it starts listening, and keeps the card data up to date by importing Scryfall's
// bulk file once a day (the first import downloads about 80 MB).
//
// Environment:
//
//	DATABASE_URL   Postgres connection URL (default: the local development database;
//	               the password comes from pgpass, see scripts/setup-dev-db.sh)
//	ADDR           address to listen on (default: 127.0.0.1:8080, where the Vite dev proxy sends /api)
//	SCRYFALL_SYNC  "daily" (the default) or "off"; `go run ./cmd/sync` imports on demand.
//	               With several server instances, leave it on for one: the others would
//	               only find the import lock taken.
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

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/api"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/cards"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/scryfall"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/store"
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
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	var background func(context.Context)
	if cfg.DailySync {
		importer := &cards.Importer{Pool: pool, Source: scryfall.New(), LockKey: cards.DefaultLockKey, Log: slog.Default()}
		background = func(ctx context.Context) { importer.RunDaily(ctx, syncCheckEvery) }
	}
	return serve(ctx, cfg.Addr, api.NewHandler(pool, &cards.Searcher{Q: store.New(pool)}), background)
}

// serve runs handler on addr, with background (if not nil) running alongside it, until ctx
// ends or the server fails. Either way it stops background and waits for it before
// returning, so nothing is still using the database when the caller closes it.
func serve(ctx context.Context, addr string, handler http.Handler, background func(context.Context)) error {
	var wg sync.WaitGroup
	defer wg.Wait()
	bgCtx, stopBackground := context.WithCancel(ctx)
	defer stopBackground() // runs before wg.Wait: also when the server fails to start
	if background != nil {
		wg.Go(func() { background(bgCtx) })
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", addr)

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
