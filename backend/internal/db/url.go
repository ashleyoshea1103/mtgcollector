package db

// DefaultURL is the local development database that scripts/setup-dev-db.sh creates. It
// has no password: libpq and pgx read it from the pgpass file the script writes.
const DefaultURL = "postgres://mtgcollector@localhost:5432/mtgcollector"
