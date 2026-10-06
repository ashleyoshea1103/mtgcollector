#!/usr/bin/env bash
# Installs this repository's pre-push check. Run once per clone: ./scripts/install-hooks.sh
#
# Only a pre-push shim goes into .git/hooks. We deliberately don't point
# core.hooksPath at the tracked .githooks/ folder: then any branch you check out
# could add a post-checkout (or other) hook and run code on your machine.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
hooks_dir=$(git rev-parse --git-common-dir)/hooks
marker='installed by scripts/install-hooks.sh'

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
if [[ -e $target ]] && ! grep -qs "$marker" "$target"; then
  echo "$target already exists and wasn't installed by this script; not overwriting it." >&2
  exit 1
fi

mkdir -p "$hooks_dir"
cat >"$target" <<EOF
#!/usr/bin/env bash
# Pre-push check, $marker.
# Runs the repository's .githooks/pre-push, which verifies each pushed commit.
exec "\$(git rev-parse --show-toplevel)/.githooks/pre-push" "\$@"
EOF
chmod +x "$target"
echo "Installed the pre-push check at $target."
