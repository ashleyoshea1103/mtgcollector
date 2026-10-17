#!/usr/bin/env bash
# Installs this repository's pre-push check. Run once per clone, and again after
# reviewing any change to .githooks/pre-push, scripts/check-lockfile.mjs or
# backend/cmd/modcache-check: ./scripts/install-hooks.sh
#
# The hook is COPIED into .git/hooks. We deliberately don't point core.hooksPath at
# the tracked .githooks/ folder, or install a shim that runs it from the working
# tree: either way, a branch you check out (e.g. someone else's pull request)
# could change the hook and run code on your machine.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
hooks_dir=$(cd "$(git rev-parse --git-common-dir)" && pwd)/hooks
marker='# installed by scripts/install-hooks.sh'

hooks_path=$(git config --get core.hooksPath || true)
if [[ $hooks_path == .githooks ]]; then
  git config --unset core.hooksPath
  echo 'Removed core.hooksPath=.githooks (the old, unsafe setup).'
elif [[ -n $hooks_path ]]; then
  echo "core.hooksPath is set to '$hooks_path', so git ignores .git/hooks." >&2
  echo 'Unset it (git config --unset core.hooksPath) or add the pre-push check there yourself.' >&2
  exit 1
fi

target=$hooks_dir/pre-push
if [[ -e $target ]] && ! grep -qs 'installed by scripts/install-hooks.sh' "$target"; then
  echo "$target already exists and wasn't installed by this script; not overwriting it." >&2
  exit 1
fi
command -v go >/dev/null || { echo 'go is not on PATH; install Go (see backend/go.mod for the version).' >&2; exit 1; }

mkdir -p "$hooks_dir"
# The hook's check on its Go module cache, built from this checkout as the hook is copied
# from it. It uses only the standard library, so building it downloads nothing. The copy of
# its source is what verify compares to warn that the installed build is out of date.
export GOENV=off GOFLAGS='' GOTOOLCHAIN=local GOWORK=off
go -C backend build -trimpath -o "$hooks_dir/modcache-check$(go env GOEXE)" ./cmd/modcache-check
for f in backend/cmd/modcache-check/*.go; do [[ $f == *_test.go ]] || cat "$f"; done >"$hooks_dir/modcache-check.src"
# The tracked hook with the marker line added after its shebang, plus the lockfile check it runs
# before installing anything (a trusted copy, so the code being pushed can't weaken it).
{ head -n 1 .githooks/pre-push; echo "$marker"; tail -n +2 .githooks/pre-push; } >"$target"
chmod +x "$target"
cp scripts/check-lockfile.mjs "$hooks_dir/check-lockfile.mjs"
echo "Installed the pre-push check at $target."
