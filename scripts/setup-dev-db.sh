#!/usr/bin/env bash
# One-time setup of the local PostgreSQL databases (run it again any time; it's safe):
#   - a login role `mtgcollector` (not a superuser) with a new random password,
#   - databases `mtgcollector` (development) and `mtgcollector_test` (verify's
#     backend tests), both owned by that role,
#   - a pgpass entry with the password, so the server, the tests and the pre-push
#     hook connect without a password in any URL or environment variable.
#
# It asks for the password of the PostgreSQL superuser (`postgres`, set when you
# installed PostgreSQL) and uses it only for this script's own psql commands.
#
# Usage: ./scripts/setup-dev-db.sh
#   PGHOST / PGPORT / PGSUPERUSER override localhost / 5432 / postgres.
set -euo pipefail

host=${PGHOST:-localhost}
port=${PGPORT:-5432}
superuser=${PGSUPERUSER:-postgres}
role=mtgcollector

psql=$(command -v psql || true)
if [[ -z $psql ]]; then
  # The Windows installer doesn't put psql on PATH; use the newest installed version.
  psql=$(ls -d /c/Program\ Files/PostgreSQL/*/bin/psql.exe 2>/dev/null | sort -V | tail -1 || true)
fi
[[ -n $psql ]] || { echo "psql not found; install PostgreSQL or put its bin folder on PATH" >&2; exit 1; }

if [[ -n ${APPDATA:-} ]]; then
  passfile="$APPDATA/postgresql/pgpass.conf" # where libpq and pgx look on Windows
else
  passfile="$HOME/.pgpass"
fi

read -rsp "Password for PostgreSQL superuser '$superuser' on $host:$port: " PGPASSWORD
echo
export PGPASSWORD

# 32 random bytes as hex: nothing in it needs quoting in SQL or pgpass.
password=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')

# Values reach SQL only through psql variables (:'name' quotes them), never by
# pasting them into the SQL text. They're set on stdin rather than as -v arguments,
# so the password never appears in a process's command line.
"$psql" -X -q -v ON_ERROR_STOP=1 -h "$host" -p "$port" -U "$superuser" -d postgres <<SQL
\set role '$role'
\set password '$password'
SELECT format('CREATE ROLE %I LOGIN', :'role')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L', :'role', :'password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', db, :'role')
  FROM unnest(ARRAY['mtgcollector', 'mtgcollector_test']) AS db
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = db) \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', db, :'role')
  FROM unnest(ARRAY['mtgcollector', 'mtgcollector_test']) AS db \gexec
SQL
unset PGPASSWORD

# Replace this role's entry for this server, keeping any other entries.
mkdir -p "$(dirname "$passfile")"
touch "$passfile"
chmod 600 "$passfile" # libpq ignores a group/world-readable file (no effect on Windows)
grep -v "^$host:$port:\*:$role:" "$passfile" >"$passfile.tmp" || true
echo "$host:$port:*:$role:$password" >>"$passfile.tmp"
mv "$passfile.tmp" "$passfile"

# Check the new login works, as verify will use it.
"$psql" -X -q -h "$host" -p "$port" -U "$role" -d mtgcollector_test -w -c 'SELECT 1' >/dev/null ||
  { echo "couldn't log in as $role with the new password from $passfile" >&2; exit 1; }
echo "Ready: role $role, databases mtgcollector and mtgcollector_test, password saved in $passfile"
