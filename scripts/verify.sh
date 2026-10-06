#!/usr/bin/env bash
# Every check a change must pass before it can be pushed or merged:
#   0. setup            – lockfile sources (before installing), clean install, test file names
#   1. compile          – lint (warnings fail), type check, production build, no dev-only code shipped
#   2. unit tests       – pure logic
#   3. behaviour checks – components rendered and driven as a user would
#
# Run by the pre-push hook (.githooks/pre-push, on a clean checkout of the pushed
# commit) and by CI (.github/workflows/verify.yml). Stops at the first failure.
#
# Usage: ./scripts/verify.sh
#   CI=true or VERIFY_CLEAN_INSTALL=1   install dependencies from the lockfile first (npm ci)
set -euo pipefail

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

# Before anything is installed from it.
run 'frontend: lockfile sources' node scripts/check-lockfile.mjs frontend/package-lock.json

if [[ -n "${CI:-}" || -n "${VERIFY_CLEAN_INSTALL:-}" ]]; then
  # --ignore-scripts here as well as in .npmrc, which a change could delete.
  run 'frontend: npm ci' npm ci --prefix frontend --ignore-scripts --no-audit --no-fund
elif [[ ! -d frontend/node_modules ]]; then
  fail 'frontend/node_modules is missing; run `npm install` in frontend/'
fi

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
run 'frontend: lint' npm run --prefix frontend --silent lint
run 'frontend: type check + build' npm run --prefix frontend --silent build
printf -- '--- %s\n' 'frontend: production bundle has no dev-only code'
# Dev-only modules embed DEV_ONLY_MARKER (frontend/src/devOnly.ts); finding it in dist means one shipped.
if grep -rlF 'mtgcollector:dev-only' frontend/dist; then
  fail 'the production bundle contains dev-only code (gallery or fixtures)'
fi

# --- 2. unit tests ----------------------------------------------------------
stage '2/3 unit tests'
run 'frontend: unit tests' npm run --prefix frontend --silent test:unit

# --- 3. behaviour checks ----------------------------------------------------
stage '3/3 behaviour checks'
run 'frontend: behaviour tests' npm run --prefix frontend --silent test:behaviour

printf '\n%sverify passed%s\n' "$green" "$reset"
