// Command server runs the HTTP API. It applies any pending database migrations
// before it starts listening.
//
// Environment:
//
//	DATABASE_URL  Postgres connection URL (default: the local development database;
//	              the password comes from pgpass, see scripts/setup-dev-db.sh)
//	ADDR          address to listen on (default: 127.0.0.1:8080, where the Vite dev proxy sends /api)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/api"
	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
)

type config struct {
	DatabaseURL string
	Addr        string
}

const (
	defaultDatabaseURL = "postgres://mtgcollector@localhost:5432/mtgcollector"
	defaultAddr        = "127.0.0.1:8080"
	shutdownTimeout    = 10 * time.Second
)

func loadConfig(getenv func(string) string) config {
	cfg := config{DatabaseURL: getenv("DATABASE_URL"), Addr: getenv("ADDR")}
	if cfg.DatabaseURL == "" {
		cfg.DatabaseURL = defaultDatabaseURL
	}
	if cfg.Addr == "" {
		cfg.Addr = defaultAddr
	}
	return cfg
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		stop() // a second Ctrl-C during the graceful shutdown kills the process
	}()
	if err := run(ctx, loadConfig(os.Getenv)); err != nil {
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
