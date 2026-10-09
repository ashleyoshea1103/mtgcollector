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
Run the API. It applies database migrations when it starts, then imports Scryfall's card data in the background (about 80 MB, 10 seconds or so) and again once a day. Set `SCRYFALL_SYNC=off` to skip that, and `go run ./cmd/sync` to import on demand.
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

## API
All responses are JSON, shaped by the types in `backend/internal/contract` (and so `frontend/src/types.ts`). Errors are `{"error": "…"}` with a 4xx or 5xx status.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Whether the API can reach its database. |
| `GET /api/cards/search?q=&set=&type=&rarity=&colors=&extras=&page=` | A page of cards (`CardPage`), one printing each: an English one if there is, the newest. `q` is words the name contains, in any order, at least one of 3+ letters; or give `set` (a code like `mh2`) instead. `type` is words the type line contains. `colors` is letters from `WUBRG` the card must all be, or `C` for colourless. Tokens, emblems and other non-game cards are left out unless `extras=true`. |
| `GET /api/cards/autocomplete?q=` | Up to 20 card names containing `q` (`CardNames`), best matches first; nothing until 3 letters are typed. |
| `GET /api/cards/{id}` | One printing in full (`Card`), by Scryfall id. |
| `GET /api/cards/{id}/printings?page=` | A page of every printing of that card, newest first, including ones Scryfall no longer lists (`no_longer_listed`). |

Pages hold 60 cards, up to page 50.

After changing the Go structs in `backend/internal/contract`, or the SQL in `backend/internal/db` (migrations or queries), run `go generate ./...` in `backend/`. It regenerates the frontend's types with tygo and the database code in `backend/internal/store` with sqlc. The tools are pinned in their own module, `backend/tools/go.mod`, so their dependencies don't mix with the app's.

## Workflow
- `main` holds releases and `develop` is where work is integrated.
- Each feature is built on a `feature/<name>` branch and merged into `develop` by pull request.
- Every push and pull request must pass `./scripts/verify.sh`; see [CONTRIBUTING.md](CONTRIBUTING.md).
