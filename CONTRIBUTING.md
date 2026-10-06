# Contributing

## Branches and pull requests
- `main` holds releases and `develop` is where work is integrated.
- Build each feature on a `feature/<name>` branch from the latest `develop`, then open a pull request back into `develop`.
- Release by opening a pull request from `develop` into `main`.

## The `verify` gate
`scripts/verify.sh` defines what "passing" means. It runs three stages and stops at the first failure:

| Stage | What it runs |
|---|---|
| 1. Compile | Frontend: oxlint, `tsc -b`, `vite build` |
| 2. Unit tests | Frontend: `npm run test:unit` (Vitest, `src/**/*.test.ts`: pure logic) |
| 3. Behaviour checks | Frontend: `npm run test:behaviour` (Vitest + React Testing Library in jsdom, `src/**/*.test.tsx`: components rendered and used as a user would) |

The backend stages (`go vet`/`go build`, `go test -short`, and API tests against Postgres) are added along with the backend.

The same script runs in two places:

- **Before every push**, from the pre-push hook in `.githooks/`. A failing check blocks the push. The hook also refuses to push if the commit you're pushing isn't the one checked out, or if you have uncommitted changes, so the checks always run on exactly what is pushed.
- **On every pull request into `develop` or `main`**, from the GitHub Actions workflow `.github/workflows/verify.yml`. Its single job, `verify`, is a required check, so a pull request can't be merged until it passes.

### Setup
Enable the hook once per clone (`npm install` in `frontend/` also does this for you):
```bash
git config core.hooksPath .githooks
```

Run the checks by hand at any time:
```bash
./scripts/verify.sh
```

Don't bypass the hook with `git push --no-verify`. Fix the failure instead.
