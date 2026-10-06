#!/usr/bin/env bash
# Every check a change must pass before it can be pushed or merged:
#   1. compile          – lint, type check, production build
#   2. unit tests       – pure logic
#   3. behaviour checks – components rendered and driven as a user would
#
# Run by the pre-push hook (.githooks/pre-push) and by CI (.github/workflows/verify.yml).
# Each project (frontend/, backend/) is checked once it exists. Stops at the first failure.
#
# Usage: ./scripts/verify.sh        (CI=true also does a clean `npm ci` first)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bold=$'\033[1m' red=$'\033[31m' green=$'\033[32m' reset=$'\033[0m'
[[ -t 1 || -n "${CI:-}" ]] || bold='' red='' green='' reset=''

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

has_frontend=false
[[ -f frontend/package.json ]] && has_frontend=true

if ! $has_frontend; then
  echo 'Nothing to verify yet: no frontend/package.json.'
  exit 0
fi

# --- setup ------------------------------------------------------------------
if $has_frontend; then
  if [[ -n "${CI:-}" ]]; then
    stage 'setup'
    run 'frontend: npm ci' npm ci --prefix frontend --no-audit --no-fund
  elif [[ ! -d frontend/node_modules ]]; then
    current_stage='setup'
    fail 'frontend/node_modules is missing; run `npm install` in frontend/'
  fi
fi

# --- 1. compile -------------------------------------------------------------
stage '1/3 compile'
if $has_frontend; then
  run 'frontend: lint' npm run --prefix frontend --silent lint
  run 'frontend: type check + build' npm run --prefix frontend --silent build
fi

# --- 2. unit tests ----------------------------------------------------------
stage '2/3 unit tests'
if $has_frontend; then
  run 'frontend: unit tests' npm run --prefix frontend --silent test:unit
fi

# --- 3. behaviour checks ----------------------------------------------------
stage '3/3 behaviour checks'
if $has_frontend; then
  run 'frontend: behaviour tests' npm run --prefix frontend --silent test:behaviour
fi

printf '\n%sverify passed%s\n' "$green" "$reset"
