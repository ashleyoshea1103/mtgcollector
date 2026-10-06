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
| 0. Setup | Lockfile sources, checked before anything is installed (`scripts/check-lockfile.mjs`: every package from the npm registry over HTTPS, with a sha512 hash, under its own name); a clean `npm ci --ignore-scripts` in CI and in the hook |
| 1. Compile | Frontend: oxlint (warnings fail; skipped, todo and focused tests are errors), `tsc -b`, and `vite build`, which fails if any dev-only module (the gallery or fixtures) is in the production bundle |
| 2. Unit tests | Frontend: `npm run test:unit` (Vitest, `src/**/*.test.ts`: pure logic, including the shared pricing cases in `testdata/pricing-cases.json`) |
| 3. Behaviour checks | Frontend: `npm run test:behaviour` (Vitest + React Testing Library in jsdom, `src/**/*.test.tsx`: components rendered and used as a user would) |

It also fails when:
- `frontend/` is missing;
- a file anywhere in the repo looks like a test but Vitest would never run it. Only `frontend/src/**/*.test.ts` and `*.test.tsx` run; names like `x.spec.ts`, `x_test.ts`, `X.TEST.ts` or anything under `__tests__/` are flagged;
- a test uses `.only`.

The backend stages (`go vet`/`go build`, `go test -short`, and API tests against Postgres) are added along with the backend.

The same script runs in two places:

- **Before every push**, from the pre-push hook. The tip commit of each ref you push is checked out into a temporary worktree and verified there after a clean install. Refs the remote already has at that commit, remote-tracking refs, and tags on commits the remote already has are skipped. Uncommitted, untracked or locally hidden files can't make a push pass, and a failure blocks the push. The push is also blocked if verifying changed `.git/config` or the installed hooks.
- **In CI**, from `.github/workflows/verify.yml`. It runs on every pull request into `develop` or `main` (including when one is retargeted) and on every push to them. CI runs under a German locale, so tests can't assume English price formatting.

### Setup
Use Node 24 (`frontend/.nvmrc`). Then, once per clone:
```bash
./scripts/install-hooks.sh
```
This copies `.githooks/pre-push` and `scripts/check-lockfile.mjs` into `.git/hooks`. They're copies, not links, so checking out a branch that changes them can't change what runs when you push. `verify` warns in three cases:
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
- the tests
