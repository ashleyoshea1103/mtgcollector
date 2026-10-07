package main

import (
	"testing"

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
	if cfg != (config{DatabaseURL: db.DefaultURL, Addr: defaultAddr, DailySync: true}) {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}

func TestLoadConfigReadsTheEnvironment(t *testing.T) {
	cfg, err := loadConfig(env(map[string]string{
		"DATABASE_URL": "postgres://u@db.example:5432/app", "ADDR": ":9000", "SCRYFALL_SYNC": "off",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg != (config{DatabaseURL: "postgres://u@db.example:5432/app", Addr: ":9000", DailySync: false}) {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}

func TestLoadConfigRejectsAnUnknownSyncSetting(t *testing.T) {
	// A typo like "of" must not silently leave the daily import on (or off).
	if _, err := loadConfig(env(map[string]string{"SCRYFALL_SYNC": "of"})); err == nil {
		t.Error("SCRYFALL_SYNC=of was accepted")
	}
}
