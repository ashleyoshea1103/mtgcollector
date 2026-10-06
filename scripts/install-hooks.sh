#!/usr/bin/env bash
# Installs this repository's pre-push check. Run once per clone, and again after
# reviewing any change to .githooks/pre-push: ./scripts/install-hooks.sh
#
# The hook is COPIED into .git/hooks. We deliberately don't point core.hooksPath at
# the tracked .githooks/ folder, or install a shim that runs it from the working
# tree: either way, a branch you check out (e.g. someone else's pull request)
# could change the hook and run code on your machine.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
hooks_dir=$(git rev-parse --git-common-dir)/hooks
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

mkdir -p "$hooks_dir"
# The tracked hook with the marker line added after its shebang.
{ head -n 1 .githooks/pre-push; echo "$marker"; tail -n +2 .githooks/pre-push; } >"$target"
chmod +x "$target"
echo "Installed the pre-push check at $target."
