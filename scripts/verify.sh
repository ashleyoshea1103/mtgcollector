#!/usr/bin/env bash
# Every check a change must pass before it can be pushed or merged:
#   0. setup            – lockfile sources (before installing), clean install, tidy go.mod, test file names
#   1. compile          – generated API types up to date; Go format, vet, staticcheck and build;
#                         frontend lint (warnings fail), type check, production build, no dev-only code shipped
#   2. unit tests       – pure logic (Go and frontend)
#   3. behaviour checks – the API against a real Postgres; components rendered and driven as a user would
#
# Run by the pre-push hook (.githooks/pre-push, on a clean checkout of the pushed
# commit) and by CI (.github/workflows/verify.yml). Stops at the first failure.
#
# Usage: ./scripts/verify.sh
#   CI=true or VERIFY_CLEAN_INSTALL=1   install dependencies from the lockfile first (npm ci)
#   TEST_DATABASE_URL                   database for the backend behaviour tests (default: the local
#                                       mtgcollector_test database from scripts/setup-dev-db.sh)
set -euo pipefail

# Use the Go that's installed, never one a pushed go.mod asks to download.
export GOTOOLCHAIN=local
export TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://mtgcollector@localhost:5432/mtgcollector_test}

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bold=$'\033[1m' red=$'\033[31m' green=$'\033[32m' yellow=$'\033[33m' reset=$'\033[0m'
[[ -t 1 || -n "${CI:-}" ]] || bold='' red='' green='' yellow='' reset=''

current_stage=''
stage() {
  current_stage=$1
  printf '\n%s==> %s%s\n' "$bold" "$1" "$reset"
}
fail() {
  printf '\n%sverify FAILED in stage "%s": %s%s\n' "$red" "$current_stage" "$1" "$reset" >&2
  exit 1
}
# run <description> <command...>: runs a step and names it if it fails.
run() {
  local what=$1
  shift
  printf -- '--- %s\n' "$what"
  "$@" || fail "$what"
}

# --- setup ------------------------------------------------------------------
stage 'setup'
# The frontend always exists; a change that removes or moves it must not pass by checking nothing.
[[ -f frontend/package.json ]] || fail 'frontend/package.json is missing'
[[ -f backend/go.mod ]] || fail 'backend/go.mod is missing'
command -v go >/dev/null || fail 'go is not on PATH; install Go (see backend/go.mod for the version)'

# Before anything is installed from it.
run 'frontend: lockfile sources' node scripts/check-lockfile.mjs frontend/package-lock.json

if [[ -n "${CI:-}" || -n "${VERIFY_CLEAN_INSTALL:-}" ]]; then
  # --ignore-scripts here as well as in .npmrc, which a change could delete.
  run 'frontend: npm ci' npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
elif [[ ! -d frontend/node_modules ]]; then
  fail 'frontend/node_modules is missing; run `npm install` in frontend/'
fi
# go.sum pins every module's hash, and the go command checks downloads against it.
run 'backend: go.mod and go.sum are tidy' go -C backend mod tidy -diff

if [[ -z "${CI:-}" ]]; then
  # --git-path follows core.hooksPath, so this is the hook git will actually run.
  installed_hook=$(git rev-parse --git-path hooks/pre-push)
  if [[ -n $(git config --get core.hooksPath || true) ]]; then
    printf '%swarning: core.hooksPath is set (%s), so git ignores the installed pre-push hook; unset it and run ./scripts/install-hooks.sh%s\n' \
      "$yellow" "$(git config --show-origin --get core.hooksPath)" "$reset"
  elif ! grep -qs 'installed by scripts/install-hooks.sh' "$installed_hook"; then
    printf '%swarning: the pre-push hook is not installed; run ./scripts/install-hooks.sh%s\n' "$yellow" "$reset"
  elif ! cmp -s .githooks/pre-push <(grep -v 'installed by scripts/install-hooks.sh' "$installed_hook") ||
    ! cmp -s scripts/check-lockfile.mjs "$(dirname "$installed_hook")/check-lockfile.mjs"; then
    printf '%swarning: .githooks/pre-push or scripts/check-lockfile.mjs differs from the installed copy; review the change, then run ./scripts/install-hooks.sh%s\n' "$yellow" "$reset"
  fi
fi

# Every test file anywhere in the repo must be one Vitest runs: frontend/src/**/*.test.ts (unit)
# or *.test.tsx (behaviour). Catches __tests__/ folders and test/spec/tests/specs names in any
# case or separator. quotePath=false keeps non-ASCII names as-is so the patterns can match them.
stray_tests=$(git -c core.quotePath=false ls-files |
  grep -iE '(^|/)__tests__/|[._-](test|spec)s?\.[cm]?[jt]sx?$' |
  grep -vE '^frontend/src/.*\.test\.tsx?$' || true)
[[ -z "$stray_tests" ]] || fail "test files that would never run (rename to src/**/*.test.ts or *.test.tsx):
$stray_tests"

# --- 1. compile -------------------------------------------------------------
stage '1/3 compile'
printf -- '--- %s
' 'backend: frontend/src/types.ts matches the Go contract'
# Generate into a scratch file with the same config, so a stale (or hand-edited) types.ts is
# reported, not overwritten.
generated=$(mktemp -d)
trap 'rm -rf "$generated"' EXIT
generated_ts=$generated/types.ts
# tygo reads this path from YAML, so on Windows it must be a Windows path (Git Bash only
# converts paths in command-line arguments).
if command -v cygpath >/dev/null; then generated_ts=$(cygpath -m "$generated_ts"); fi
sed "s|output_path: .*|output_path: $generated_ts|" backend/tygo.yaml >"$generated/tygo.yaml"
go -C backend tool tygo generate --config "$generated/tygo.yaml" || fail 'tygo generate failed'
if ! diff -u frontend/src/types.ts "$generated/types.ts"; then
  fail 'frontend/src/types.ts is stale; run `go tool tygo generate` in backend/ and commit the result'
fi
unformatted=$(gofmt -l backend)
[[ -z $unformatted ]] || fail "not gofmt-formatted (run gofmt -w backend):
$unformatted"
# Each Go check covers the integration-tagged test files too.
run 'backend: go vet' go -C backend vet -tags=integration ./...
run 'backend: staticcheck' go -C backend tool staticcheck -tags=integration ./...
run 'backend: go build' go -C backend build ./...
run 'frontend: lint' npm run --prefix frontend --silent lint
run 'frontend: type check + build' npm run --prefix frontend --silent build
printf -- '--- %s\n' 'frontend: production bundle has no dev-only code'
# Dev-only modules embed DEV_ONLY_MARKER (frontend/src/devOnly.ts); finding it in dist means one shipped.
if grep -rlF 'mtgcollector:dev-only' frontend/dist; then
  fail 'the production bundle contains dev-only code (gallery or fixtures)'
fi

# --- 2. unit tests ----------------------------------------------------------
stage '2/3 unit tests'
run 'backend: unit tests' go -C backend test ./...
run 'frontend: unit tests' npm run --prefix frontend --silent test:unit

# --- 3. behaviour checks ----------------------------------------------------
stage '3/3 behaviour checks'
# The integration tag adds the tests that use the database (each gets a schema of its own).
# Without a database they fail, never skip.
run 'backend: API behaviour tests (Postgres)' go -C backend test -tags=integration ./...
run 'frontend: behaviour tests' npm run --prefix frontend --silent test:behaviour

printf '\n%sverify passed%s\n' "$green" "$reset"
