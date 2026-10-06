#!/usr/bin/env bash
# Every check a change must pass before it can be pushed or merged:
#   1. compile          – lint (warnings fail), lockfile sources, type check, production build
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

if [[ -n "${CI:-}" || -n "${VERIFY_CLEAN_INSTALL:-}" ]]; then
  run 'frontend: npm ci' npm ci --prefix frontend --no-audit --no-fund
elif [[ ! -d frontend/node_modules ]]; then
  fail 'frontend/node_modules is missing; run `npm install` in frontend/'
fi

if [[ -z "${CI:-}" ]] && ! grep -qs 'installed by scripts/install-hooks.sh' "$(git rev-parse --git-common-dir)/hooks/pre-push"; then
  printf '%swarning: the pre-push hook is not installed; run ./scripts/install-hooks.sh%s\n' "$yellow" "$reset"
fi

# Every test file must be one Vitest runs: src/**/*.test.ts (unit) or src/**/*.test.tsx (behaviour).
stray_tests=$(git ls-files -- frontend | grep -E '\.(test|spec)\.[cm]?[jt]sx?$' | grep -vE '^frontend/src/.*\.test\.tsx?$' || true)
[[ -z "$stray_tests" ]] || fail "test files that would never run (rename to src/**/*.test.ts or *.test.tsx):
$stray_tests"

# --- 1. compile -------------------------------------------------------------
stage '1/3 compile'
run 'frontend: lint' npm run --prefix frontend --silent lint
run 'frontend: lockfile sources' npm run --prefix frontend --silent lint:lockfile
run 'frontend: type check + build' npm run --prefix frontend --silent build
printf -- '--- %s\n' 'frontend: production bundle has no dev-only code'
if grep -rlF '/dev/components' frontend/dist; then
  fail 'the production bundle contains the dev-only component gallery'
fi

# --- 2. unit tests ----------------------------------------------------------
stage '2/3 unit tests'
run 'frontend: unit tests' npm run --prefix frontend --silent test:unit

# --- 3. behaviour checks ----------------------------------------------------
stage '3/3 behaviour checks'
run 'frontend: behaviour tests' npm run --prefix frontend --silent test:behaviour

printf '\n%sverify passed%s\n' "$green" "$reset"
