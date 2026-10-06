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
| 1. Compile | Frontend: oxlint (warnings fail), `tsc -b`, `vite build`, and a check that the production bundle has no dev-only code |
| 2. Unit tests | Frontend: `npm run test:unit` (Vitest, `src/**/*.test.ts`: pure logic, including the shared pricing cases in `testdata/pricing-cases.json`) |
| 3. Behaviour checks | Frontend: `npm run test:behaviour` (Vitest + React Testing Library in jsdom, `src/**/*.test.tsx`: components rendered and used as a user would) |

It also fails when:
- `frontend/` is missing;
- a test file is named so Vitest would never run it (anything other than `src/**/*.test.ts` or `*.test.tsx`);
- a test uses `.only`.

The backend stages (`go vet`/`go build`, `go test -short`, and API tests against Postgres) are added along with the backend.

The same script runs in two places:

- **Before every push**, from the pre-push hook. The tip commit of each ref you push is checked out into a temporary worktree and verified there after a clean install. Refs the remote already has at that commit are skipped. Uncommitted, untracked or locally hidden files can't make a push pass, and a failure blocks the push.
- **In CI**, from `.github/workflows/verify.yml`. It runs on every pull request into `develop` or `main` (including when one is retargeted) and on every push to them. CI runs under a German locale, so tests can't assume English price formatting.

### Setup
Use Node 24 (`frontend/.nvmrc`). Then, once per clone:
```bash
./scripts/install-hooks.sh
```
This copies `.githooks/pre-push` into `.git/hooks`. It's a copy, not a link, so checking out a branch that changes the hook can't change what runs when you push. `verify` warns if the hook isn't installed, or if `.githooks/pre-push` has changed since you installed it. In that case, review the change, then run the install script again.

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
