# Contributing

## Branches and pull requests
- `main` holds releases and `develop` is where work is integrated. A repository ruleset protects both:
  - Changes go in only through a pull request.
  - The `verify` check from GitHub Actions must pass.
  - The branch must be up to date before merging.
  - Force-pushes and deletion are blocked, with no bypass.
- Build each feature on a `feature/<name>` branch from the latest `develop`, then open a pull request back into `develop`.
- Release by opening a pull request from `develop` into `main`.

## The `verify` gate
`scripts/verify.sh` defines what "passing" means. It runs these stages in order and stops at the first failure:

| Stage | What it runs |
|---|---|
| 0. Setup | Lockfile sources, checked before anything is installed (`scripts/check-lockfile.mjs`: every package from the npm registry over HTTPS, with a sha512 hash, under its own name); a clean `npm ci --ignore-scripts` in CI and in the hook. Backend: `go.mod` and `go.sum` are tidy (`go mod tidy -diff`), for the app and for the tools module (`backend/tools`) |
| 1. Compile | Backend: `frontend/src/types.ts` matches what tygo generates from `backend/internal/contract`; the sqlc code in `backend/internal/store` matches the SQL (`sqlc diff`); `gofmt`, `go vet`, staticcheck and `go build`. Frontend: oxlint (warnings fail; skipped, todo and focused tests are errors), `tsc -b`, and `vite build`, which fails if any dev-only module (the gallery or fixtures) is in the production bundle |
| 2. Unit tests | Backend: `go test ./...` (no database). Frontend: `npm run test:unit` (Vitest, `src/**/*.test.ts`: pure logic, including the shared pricing cases in `testdata/pricing-cases.json`) |
| 3. Behaviour checks | Backend: `go test -tags=integration ./...`, the API and migrations against a real PostgreSQL. Each test gets a freshly migrated schema of its own, dropped when it ends. Frontend: `npm run test:behaviour` (Vitest + React Testing Library in jsdom, `src/**/*.test.tsx`: components rendered and used as a user would) |

It also fails when:
- `frontend/` is missing;
- a file anywhere in the repo looks like a test but Vitest would never run it. Only `frontend/src/**/*.test.ts` and `*.test.tsx` run; names like `x.spec.ts`, `x_test.ts`, `X.TEST.ts` or anything under `__tests__/` are flagged;
- a test uses `.only`.

The backend behaviour tests need a database, and fail (never skip) without one. They use `TEST_DATABASE_URL`, which defaults to the local `mtgcollector_test` database that `scripts/setup-dev-db.sh` creates, and refuse to run in any database whose name doesn't end in `_test`. CI runs the same setup script against a PostgreSQL 18 service container, so the tests run there as the same non-superuser role as locally. Go must be the version in `backend/go.mod` or newer: verify uses the installed Go (`GOTOOLCHAIN=local`) rather than downloading another.

The same script runs in two places:

- **Before every push**, from the pre-push hook. The tip commit of each ref you push is checked out into a temporary worktree and verified there after a clean install. Refs the remote already has at that commit, remote-tracking refs, and tags on commits the remote already has are skipped. Uncommitted, untracked or locally hidden files can't make a push pass, and a failure blocks the push. The push is also blocked if verifying changed `.git/config`, the installed hooks or your go env file, or left a modified module in the Go module cache (`go mod verify`). The hook, not the pushed code, sets the Go environment: it ignores your go env file and `GOFLAGS` (so `GOPRIVATE` or a private `GOPROXY` set there doesn't apply), uses the installed Go, fetches modules only from the public proxy, checked against the public checksum database, and keeps its own module and build caches in `.git/pre-push-go`, so verified code can't leave anything in the caches your everyday builds use. Your global and system git config are watched too. These checks are tripwires, not a sandbox: verify runs the pushed code with your permissions.
- **In CI**, from `.github/workflows/verify.yml`. It runs on every pull request into `develop` or `main` (including when one is retargeted) and on every push to them. CI runs under a German locale, so tests can't assume English price formatting.

### Setup
Use Node 24 (`frontend/.nvmrc`), Go (`backend/go.mod`) and a local PostgreSQL 18. Then, once per clone:
```bash
./scripts/install-hooks.sh
./scripts/setup-dev-db.sh
```
`setup-dev-db.sh` asks for your PostgreSQL superuser password. It creates two databases, each owned by its own login role of the same name:
- `mtgcollector`, for development;
- `mtgcollector_test`, for verify's backend tests.

Separate roles mean test code can't reach development data. The roles aren't superusers, can't create roles or databases, and only the owning role may connect to each database. Each gets a random password, saved for that one database in your pgpass file (`PGPASSFILE`, or `%APPDATA%\postgresql\pgpass.conf` on Windows), where the server, the tests and the hook find it. The passwords never go in a URL, a command line or the server log. Running the script again is safe, and it sets new passwords. It needs psql 15 or newer.

`install-hooks.sh` copies `.githooks/pre-push` and `scripts/check-lockfile.mjs` into `.git/hooks`. They're copies, not links, so checking out a branch that changes them can't change what runs when you push. `verify` warns in three cases:
- the hook isn't installed;
- `core.hooksPath` is set, which makes git ignore the installed hook;
- either file has changed since you installed it.

In the last case, review the change, then run the install script again.

We deliberately don't use `core.hooksPath`: pointing it at a tracked folder would let any branch you check out add a hook that runs code on your machine. For the same reason, `frontend/.npmrc` sets `ignore-scripts=true`, so dependencies can't run install scripts.

Run the checks by hand at any time:
```bash
./scripts/verify.sh
```

Don't bypass the hook with `git push --no-verify`. Fix the failure instead.

### Reviewing other people's branches
`verify` runs the code it checks: the build config, the tests, and the script itself. Before you push, or run `verify` on, a branch you didn't write, read its changes to:
- `scripts/`
- `.githooks/`
- `.github/`
- `frontend/package*.json`
- `frontend/.npmrc`
- `frontend/vite.config.ts`
- `backend/go.mod`, `backend/tools/go.mod`, `backend/tygo.yaml`, `backend/sqlc.yaml`, `backend/generate.go` and `backend/internal/testdb`
- the tests
