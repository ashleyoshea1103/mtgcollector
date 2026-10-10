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
The API's own responses are JSON, shaped by the types in `backend/internal/contract` (and so `frontend/src/types.ts`); its errors are `{"error": "…"}` with a 4xx or 5xx status. (The router's redirect from an unclean path, such as `//`, is plain text.)

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Whether the API can reach its database. |
| `GET /api/cards/search?q=&set=&type=&rarity=&colors=&extras=&page=` | A page of cards (`CardPage`), one printing each: English if there is one, released, from a regular set rather than a promo or special printing, then the newest; with `set`, that set's printing. `q` is words the name contains, in any order; one of them needs 3 letters or digits in a row, unless `set` (a code like `mh2`) is given. `type` is words the type line contains. `colors` is letters from `WUBRG` the card must all be, or `C` for colourless. Printings Scryfall no longer lists are left out, and so are tokens, emblems, substitute cards and other non-game cards unless `extras=true`. |
| `GET /api/cards/autocomplete?q=` | Up to 20 card names containing `q` (`CardNames`), best matches first; nothing until 3 letters or digits in a row are typed. |
| `GET /api/cards/{id}` | One printing in full (`Card`), by Scryfall id. |
| `GET /api/cards/{id}/printings?page=` | A page of every printing of that card, newest first, including ones Scryfall no longer lists (`no_longer_listed`). |
| `POST /api/auth/signup` | Creates an account from `Credentials` (`{email, password}`; a password of 15 to 256 characters) and signs it in: 201 with the `User`. 409 if the email already has an account. |
| `POST /api/auth/login` | Signs in with `Credentials`: 200 with the `User`, or 401 whether the email or the password was wrong. |
| `POST /api/auth/logout` | Ends this browser's session: 204. |
| `GET /api/auth/me` | The signed-in `User`, or 401. |
| `GET /api/collection/groups?group_by=` | The signed-in user's groups (`CollectionGroups`) for one way of grouping (`none` if left out), with each group's totals. Groups with none of the user's cards are left out, except `none`'s one group, `all`. |
| `GET /api/collection/entries?group_by=&key=&sort=&cursor=` | A page of one group's entries (`EntryPage`), sorted by `name` (the default; Unicode order, so "Æther Vial" sorts with the aethers), `price` (most valuable copy first, unpriced last), `cmc` or `added` (newest first: when the entry was made, not when copies were last added to it). Pass `next_cursor` back as `cursor` for the next page. |
| `GET /api/collection/stats` | Totals for the whole collection (`CollectionStats`). |
| `POST /api/collection/entries` | Adds copies (`NewEntry`): 201 with a new entry, or 200 with the entry of the same printing, finish, condition and language they were added to. |
| `PATCH /api/collection/entries/{id}` | Changes an entry's quantity, finish, condition or language (`EntryChange`): 200 with the entry; 409 if it would then be the same as another of yours. |
| `DELETE /api/collection/entries/{id}` | Removes an entry: 204. |

Pages hold 60 cards, up to page 50.

**The collection.** Every collection endpoint needs a signed-in user, and only ever sees that user's cards (another user's entry is a 404). An entry holds 1 to 999 copies; its finish must be one the printing comes in. A collection holds at most 50,000 entries (`MaxEntries`); past that, only copies of entries already there can be added. Its EUR price is the regular price for non-foil, and the foil price, else the regular one, for foil and etched (the rules in `testdata/pricing-cases.json`, which the frontend and the server's tests both run); a card Scryfall no longer lists has no price. Totals add up the priced cards and count the others as `unpriced_count`. The `group_by` values and their groups' keys:

| `group_by` | Groups (in order) |
|---|---|
| `none` | `all` |
| `set` | the set codes, newest set first (sets released the same day by name; those with no date last) |
| `color` | by colour identity: `W`, `U`, `B`, `R`, `G`, `M` (several), `C` (none) |
| `type` | the front face's first of `creature`, `planeswalker`, `battle`, `instant`, `sorcery`, `artifact`, `enchantment`, `land`; else `other` |
| `rarity` | `mythic`, `rare`, `uncommon`, `common`, `special`, `bonus` |
| `cmc` | mana value, rounded down: `0` to `6`, then `7` for 7 or more |

**Signing in.** A session lasts about 30 days from its last use (its expiry moves forward at most once a day), and 90 days at most; the browser holds it in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, and the database only the token's SHA-256. Passwords are hashed with argon2id. Request bodies are JSON (`Content-Type: application/json`, at most 16 KB, no unknown fields). Requests that change anything are refused (403) when a browser says they come from another site, by their `Sec-Fetch-Site` or `Origin` header.

**Limits.** Each client (IP address, or IPv6 /56) may make 20 API requests a second, in bursts of up to 60, and sign up or log in 10 times a minute. After 10 failed logins to one account, that client may try it once a minute; failures from other clients don't count, so no one can lock an account's owner out. Past a limit, the answer is 429 with `Retry-After`. The limits are kept in memory, per server.

After changing the Go structs in `backend/internal/contract`, or the SQL in `backend/internal/db` (migrations or queries), run `go generate ./...` in `backend/`. It regenerates the frontend's types with tygo and the database code in `backend/internal/store` with sqlc. The tools are pinned in their own module, `backend/tools/go.mod`, so their dependencies don't mix with the app's.

In development the session cookie is `Secure` too, which browsers allow on `http://localhost`. If yours doesn't keep it (signing in works but `/api/auth/me` still says 401), use a browser that does, such as Chrome or Firefox.

## Running it for real
Build the frontend (`npm run build` in `frontend/`) and point the server at it with `STATIC_DIR=frontend/dist`: it then serves the app as well as the API, with a Content-Security-Policy that allows no inline scripts and images only from Scryfall. Other settings, all environment variables (see `backend/cmd/server/main.go`):
- `ALLOWED_HOSTS`: the names the site is reached by, like `cards.example.com`. Requests for any other `Host` are refused, so another site can't point its DNS at the server and use it as its own. The default allows only `localhost`, `127.0.0.1` and `::1`.
- `DATABASE_URL`: a database on another machine needs `sslmode=verify-full`; the server won't start otherwise.
- The session cookie is `Secure`, so the site must be served over HTTPS, by a reverse proxy in front of the server. Behind a proxy, every request comes from the proxy's address, so the per-client limits would be shared by everyone; taking the client's address from the proxy's header is still to do.

## Workflow
- `main` holds releases and `develop` is where work is integrated.
- Each feature is built on a `feature/<name>` branch and merged into `develop` by pull request.
- Every push and pull request must pass `./scripts/verify.sh`; see [CONTRIBUTING.md](CONTRIBUTING.md).
