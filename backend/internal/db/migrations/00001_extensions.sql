-- +goose Up
-- pg_trgm: fuzzy card-name search. citext: case-insensitive email addresses.
-- Both are trusted extensions, so the database owner can create them without being
-- a superuser. They go in public, which every schema's search_path includes (the
-- integration tests run each test in a schema of its own).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- +goose Down
-- The extensions stay: they're shared by every schema in the database (including other
-- tests' schemas), and dropping them would break whatever else uses them.
SELECT 1;
