package main

import (
	"context"
	"net"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/ashleyoshea1103/mtgcollector/backend/internal/db"
)

func env(vars map[string]string) func(string) string {
	return func(k string) string { return vars[k] }
}

func TestLoadConfigDefaultsToTheLocalDevelopmentSetup(t *testing.T) {
	cfg, err := loadConfig(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if want := (config{DatabaseURL: db.DefaultURL, Addr: defaultAddr, DailySync: true, AllowedHosts: []string{"localhost", "127.0.0.1", "::1"}}); !reflect.DeepEqual(cfg, want) {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}

func TestLoadConfigReadsTheEnvironment(t *testing.T) {
	cfg, err := loadConfig(env(map[string]string{
		"DATABASE_URL": "postgres://u@db.example:5432/app", "ADDR": ":9000", "SCRYFALL_SYNC": "off",
		"ALLOWED_HOSTS": "collection.example.com, www.collection.example.com", "STATIC_DIR": "../frontend/dist",
	}))
	if err != nil {
		t.Fatal(err)
	}
	want := config{
		DatabaseURL: "postgres://u@db.example:5432/app", Addr: ":9000", DailySync: false,
		AllowedHosts: []string{"collection.example.com", "www.collection.example.com"}, StaticDir: "../frontend/dist",
	}
	if !reflect.DeepEqual(cfg, want) {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}

func TestLoadConfigRejectsAnUnknownSyncSetting(t *testing.T) {
	// A typo like "of" must not silently leave the daily import on (or off).
	if _, err := loadConfig(env(map[string]string{"SCRYFALL_SYNC": "of"})); err == nil {
		t.Error("SCRYFALL_SYNC=of was accepted")
	}
}

func TestLoadConfigRejectsHostsWithPorts(t *testing.T) {
	if _, err := loadConfig(env(map[string]string{"ALLOWED_HOSTS": "example.com:443"})); err == nil {
		t.Error("ALLOWED_HOSTS=example.com:443 was accepted; hosts are matched without their port")
	}
}

// background runs until its context ends, and reports that it stopped.
func background(stopped chan<- struct{}) func(context.Context) {
	return func(ctx context.Context) {
		<-ctx.Done()
		close(stopped)
	}
}

func TestServeReturnsAndStopsTheImportWhenItCantListen(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	stopped := make(chan struct{})

	done := make(chan error, 1)
	go func() { done <- serve(t.Context(), taken.Addr().String(), http.NotFoundHandler(), background(stopped)) }()

	select {
	case err := <-done:
		if err == nil {
			t.Error("serve() = nil, want the listen error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve() hung when the address was taken")
	}
	select {
	case <-stopped:
	default:
		t.Error("serve() returned while the background import was still running")
	}
}

func TestServeStopsTheImportOnShutdown(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	stopped := make(chan struct{})
	done := make(chan error, 1)
	go func() { done <- serve(ctx, "127.0.0.1:0", http.NotFoundHandler(), background(stopped)) }()

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("serve() = %v, want a clean shutdown", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("serve() didn't shut down")
	}
	select {
	case <-stopped:
	default:
		t.Error("serve() returned while the background import was still running")
	}
}
