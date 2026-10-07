# mtgcollector

A web app for keeping an inventory of a Magic: The Gathering collection. It finds cards with [Scryfall](https://scryfall.com/docs/api), shows Cardmarket (EUR) prices, and groups cards automatically (by set, color, type, rarity or mana value) or into your own binders, decks and boxes.

## Stack
- **frontend/**: React, Vite and TypeScript
- **backend/**: Go and PostgreSQL. The API's JSON shapes are Go structs in `backend/internal/contract`, and `frontend/src/types.ts` is generated from them.

## Development
You need Node 24 (see `frontend/.nvmrc`), Go (see `backend/go.mod`) and PostgreSQL 18 running locally. Once per clone:
```bash
./scripts/install-hooks.sh   # the pre-push check
./scripts/setup-dev-db.sh    # the local databases; asks for your PostgreSQL superuser password
```
Run the API (it applies database migrations when it starts):
```bash
cd backend
go run ./cmd/server
```
Run the frontend in another terminal. It forwards `/api` to the API:
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173/dev/components to see the component gallery, and http://localhost:5173/api/health to check that the API can reach its database.

After changing the Go structs in `backend/internal/contract`, regenerate the frontend's types with `go tool tygo generate` in `backend/`.

## Workflow
- `main` holds releases and `develop` is where work is integrated.
- Each feature is built on a `feature/<name>` branch and merged into `develop` by pull request.
- Every push and pull request must pass `./scripts/verify.sh`; see [CONTRIBUTING.md](CONTRIBUTING.md).
