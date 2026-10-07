#!/usr/bin/env bash
# One-time setup of the local PostgreSQL databases (run it again any time; it's safe):
#   - database `mtgcollector` (development), owned by login role `mtgcollector`;
#   - database `mtgcollector_test` (verify's backend tests), owned by login role
#     `mtgcollector_test`. Separate roles, so test code can't touch development data.
#   - each role gets a new random password, saved in your pgpass file for that one
#     database, so the server, the tests and the pre-push hook connect without a
#     password in any URL or environment variable.
# The roles are plain logins (no superuser, role creation, replication or RLS bypass),
# and only the owning role may connect to its database.
#
# It asks for the password of the PostgreSQL superuser (`postgres`) and uses it only for
# this script's own psql commands. In CI it reads it from PGPASSWORD instead.
# Needs psql 15 or newer (for \getenv).
#
# Usage: ./scripts/setup-dev-db.sh
#   PGHOST / PGPORT / PGSUPERUSER override localhost / 5432 / postgres.
set -euo pipefail
shopt -s inherit_errexit # so a failure inside $(setup ...) stops the script

host=${PGHOST:-localhost}
port=${PGPORT:-5432}
superuser=${PGSUPERUSER:-postgres}

psql=$(command -v psql || true)
if [[ -z $psql ]]; then
  # The Windows installer doesn't put psql on PATH; use the newest installed version.
  psql=$(ls -d /c/Program\ Files/PostgreSQL/*/bin/psql.exe 2>/dev/null | sort -V | tail -1 || true)
fi
[[ -n $psql ]] || { echo "psql not found; install PostgreSQL or put its bin folder on PATH" >&2; exit 1; }

# Where libpq (psql) and pgx look: PGPASSFILE if set, otherwise the per-user default.
if [[ -n ${PGPASSFILE:-} ]]; then
  passfile=$PGPASSFILE
elif [[ -n ${APPDATA:-} ]]; then
  passfile="$APPDATA/postgresql/pgpass.conf"
else
  passfile="$HOME/.pgpass"
fi

if [[ -z ${PGPASSWORD:-} ]]; then
  read -rsp "Password for PostgreSQL superuser '$superuser' on $host:$port: " PGPASSWORD
  echo
fi
export PGPASSWORD

# setup <database>: creates or updates the role and database of the same name, and
# prints the role's new password.
setup() {
  local password
  # 32 random bytes as hex: nothing in it needs quoting in SQL or pgpass.
  password=$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')
  # Values reach psql through the environment (\getenv), never its command line, and
  # SQL only as psql variables (:'name' quotes them), never pasted into the SQL text.
  MTG_NAME=$1 MTG_PASSWORD=$password "$psql" -X -q -v ON_ERROR_STOP=1 \
    -h "$host" -p "$port" -U "$superuser" -d postgres >/dev/null <<'SQL' || return 1
-- Keep the new password out of the server log, whatever its logging settings.
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET log_min_duration_statement = -1;
\getenv name MTG_NAME
\getenv password MTG_PASSWORD

SELECT format('CREATE ROLE %I LOGIN', :'name')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'name') \gexec
-- An existing role must not have picked up other roles' privileges (pg_execute_server_program,
-- for one, runs OS commands).
SELECT format('DO $x$ BEGIN RAISE EXCEPTION %L; END $x$',
              format('role %s is a member of other roles; remove its memberships first', :'name'))
 WHERE EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = :'name') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'name', :'password') \gexec

-- Never take over a database someone else owns.
SELECT format('DO $x$ BEGIN RAISE EXCEPTION %L; END $x$',
              format('database %s already exists and belongs to %s', datname, pg_get_userbyid(datdba)))
  FROM pg_database WHERE datname = :'name' AND pg_get_userbyid(datdba) <> :'name' \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'name', :'name')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'name') \gexec
-- Only the owner (and superusers) may connect.
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', :'name') \gexec
SQL
  echo "$password"
}

dev_password=$(setup mtgcollector)
test_password=$(setup mtgcollector_test)
unset PGPASSWORD

# Replace this server's entries for the two databases, keeping any other entries. Ours go
# first: libpq and pgx use the first line that matches, so an older catch-all would win.
mkdir -p "$(dirname "$passfile")"
touch "$passfile"
{
  echo "$host:$port:mtgcollector:mtgcollector:$dev_password"
  echo "$host:$port:mtgcollector_test:mtgcollector_test:$test_password"
  grep -vE "^$host:$port:(mtgcollector|mtgcollector_test|\*):(mtgcollector|mtgcollector_test):" "$passfile" || true
} >"$passfile.tmp"
chmod 600 "$passfile.tmp" # libpq ignores a group/world-readable file (no effect on Windows)
mv "$passfile.tmp" "$passfile"

# Check the new logins work, as the server and verify will use them.
for db in mtgcollector mtgcollector_test; do
  "$psql" -X -q -h "$host" -p "$port" -U "$db" -d "$db" -w -c 'SELECT 1' >/dev/null ||
    { echo "couldn't log in as $db with the new password from $passfile" >&2; exit 1; }
done
echo "Ready: databases mtgcollector and mtgcollector_test, each with its own role; passwords saved in $passfile"
