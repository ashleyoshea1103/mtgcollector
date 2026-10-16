#!/usr/bin/env bash
# Tests the pre-push hook's guard on its Go module cache, end to end: pushes from a scratch
# repository whose verify.sh is a stub that does what each case says, and checks which pushes
# the hook blocks. Run by scripts/verify.sh; the guard's own tests are in backend/cmd/modcache-check.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/test-pre-push.XXXXXX")
cleanup() {
  chmod -R u+w "$tmp" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

out=''
fail() {
  printf 'test-pre-push: FAILED: %s\n' "$1" >&2
  [[ -z $out ]] || printf -- '--- what the push printed:\n%s\n---\n' "$out" >&2
  exit 1
}

# A git of its own: none of your config, and none of an outer hook's GIT_DIR and the like.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
export GIT_CONFIG_GLOBAL=$tmp/gitconfig GIT_CONFIG_NOSYSTEM=1
git config --global user.name 'pre-push test'
git config --global user.email pre-push-test@example.invalid
git config --global init.defaultBranch main
git init -q --bare "$tmp/remote.git"
git init -q "$tmp/repo"
cd "$tmp/repo"
git remote add origin "$tmp/remote.git"

# Install the hook the way a clone does, from this checkout's files. They stay untracked: the
# hook verifies only what's committed, which is the stub verify.sh.
mkdir -p .githooks scripts backend/cmd/modcache-check
cp "$repo/.githooks/pre-push" .githooks/
cp "$repo/scripts/install-hooks.sh" "$repo/scripts/check-lockfile.mjs" scripts/
cp "$repo/backend/go.mod" "$repo/backend/go.sum" backend/
cp "$repo"/backend/cmd/modcache-check/*.go backend/cmd/modcache-check/
./scripts/install-hooks.sh >/dev/null

cat >scripts/verify.sh <<'EOF'
#!/usr/bin/env bash
# A stand-in for verify that does to the hook's module cache what the test says ($STUB).
set -euo pipefail
m=$GOMODCACHE/example.com/m@v1.0.0
case $STUB in
  pass) ;;
  edit) chmod u+w "$m/m.go" && echo 'func init() {}' >>"$m/m.go" ;;
  download | bad-download) cp -R "$FIXTURES/$STUB/." "$GOMODCACHE/" ;;
  fingerprints) echo >>"$(git rev-parse --path-format=absolute --git-common-dir)/pre-push-go/modcache-state" ;;
  git-config) git config --local pre-push-test.planted yes ;;
  *) exit 1 ;;
esac
EOF
git add scripts/verify.sh
git update-index --chmod=+x scripts/verify.sh
git commit -q -m 'stub verify'

# add_module <cache> <version> <hash>: example.com/m at that version, as the go command leaves
# a module it downloaded: the files, read-only, and the hash it recorded. These hashes are the
# ones golang.org/x/mod/sumdb/dirhash gives these files.
add_module() {
  local dir=$1/example.com/m@$2 download=$1/cache/download/example.com/m/@v
  mkdir -p "$dir" "$download"
  printf 'module example.com/m\n' >"$dir/go.mod"
  printf 'package m\n' >"$dir/m.go"
  chmod a-w "$dir/go.mod" "$dir/m.go"
  echo "$3" >"$download/$2.ziphash"
}
add_module "$tmp/fixtures/download" v1.1.0 'h1:nxTBtmuhkRBEbWSZH1oQJztHCcumWqAnLXnua+afY3Y='
add_module "$tmp/fixtures/bad-download" v1.2.0 'h1:nxTBtmuhkRBEbWSZH1oQJztHCcumWqAnLXnua+afY3Y=' # v1.1.0's

cache=.git/pre-push-go/mod
fresh_cache() {
  chmod -R u+w .git/pre-push-go 2>/dev/null || true
  rm -rf .git/pre-push-go
  add_module "$cache" v1.0.0 'h1:fCHMqo5ggHEQvwcrsN81zr5orRk5lClR36KRHpfUjKg='
}

# push <stub>: pushes a new commit to a new branch; what git printed is in $out, and $status
# is 0 if the push went through.
n=0
push() {
  n=$((n + 1))
  git commit -q --allow-empty -m "push $n"
  status=0
  out=$(STUB=$1 FIXTURES=$tmp/fixtures git push origin "HEAD:refs/heads/push-$n" 2>&1) || status=$?
}
expect_pass() { # expect_pass <stub> <case>
  push "$1"
  [[ $status == 0 ]] || fail "$2: the push was blocked"
}
expect_blocked() { # expect_blocked <stub> <case> <what the hook must say>
  push "$1"
  [[ $status != 0 ]] || fail "$2: the push went through"
  [[ $out == *"$3"* ]] || fail "$2: the hook didn't say \"$3\""
}

fresh_cache
expect_pass pass 'the first push'
[[ $out == *'no fingerprints yet, so hashing all 1 module(s) once'* ]] || fail "the first push didn't hash the cache"
expect_pass pass 'a push with nothing changed'
[[ $out != *hashing* ]] || fail 'a push with nothing changed hashed the cache again'

expect_blocked edit 'verify edits a cached module' "left the hook's Go module cache modified"
[[ $out == *"example.com/m@v1.0.0: its files don't match"* ]] || fail "the hook didn't name the edited module"

fresh_cache
expect_pass pass 'the first push after a fresh cache'
chmod u+w "$cache/example.com/m@v1.0.0/m.go"
echo 'func init() {}' >>"$cache/example.com/m@v1.0.0/m.go"
expect_blocked pass 'a cached module edited between pushes' "the hook's Go module cache was modified since your last push"

fresh_cache
expect_pass pass 'the first push after a fresh cache'
expect_pass download 'verify downloads a module'
[[ $out == *'hashing 1 changed module(s)'* ]] || fail "the downloaded module wasn't hashed"
expect_blocked bad-download "verify adds a module that doesn't match its recorded hash" \
  "example.com/m@v1.2.0: its files don't match"

fresh_cache
expect_pass pass 'the first push after a fresh cache'
expect_blocked git-config 'verify changes git config' 'changed .git/config'
expect_blocked fingerprints 'verify edits the fingerprints' 'modcache-state; check them'
expect_blocked pass 'a push after the fingerprints were edited' "modcache-state has a malformed line"

rm -f .git/hooks/modcache-check*
expect_blocked pass 'modcache-check is not installed' 'run ./scripts/install-hooks.sh'

echo "test-pre-push: all $n pushes did what they should"
