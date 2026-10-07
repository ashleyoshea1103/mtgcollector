package main

import "testing"

func TestLoadConfigDefaultsToTheLocalDevelopmentSetup(t *testing.T) {
	cfg := loadConfig(func(string) string { return "" })
	if cfg.DatabaseURL != defaultDatabaseURL || cfg.Addr != defaultAddr {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}

func TestLoadConfigReadsTheEnvironment(t *testing.T) {
	env := map[string]string{"DATABASE_URL": "postgres://u@db.example:5432/app", "ADDR": ":9000"}
	cfg := loadConfig(func(k string) string { return env[k] })
	if cfg.DatabaseURL != env["DATABASE_URL"] || cfg.Addr != env["ADDR"] {
		t.Errorf("loadConfig() = %+v", cfg)
	}
}
