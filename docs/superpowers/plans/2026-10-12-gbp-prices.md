# Prices in Pounds (GBP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A EUR | GBP switch that shows every Cardmarket price and total converted to pounds,
using the ECB's daily rate. The server fetches the rate and serves it at `GET /api/rates`.

**Architecture:**
- **Server:** a new Go package, `internal/rates`, parses the ECB file, stores the latest GBP rate
  in a new table and refreshes it with an hourly-checked daily job. The API serves it through a
  new contract type.
- **App:** a context, `useMoney`, holds the chosen currency and the rate. `Price` converts euro
  amounts in GBP mode, and `RateNote` says once per page where pounds come from.

**Tech Stack:** Go 1.23+ (net/http, encoding/xml, pgx/v5, sqlc, goose, tygo); React 19,
TanStack Query 5, React Aria Components, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-gbp-prices-design.md`

## Global Constraints

- **ECB source:**
  - URL `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`.
  - HTTPS to `www.ecb.europa.eu` only, a 10 s timeout and a 64 KB body cap.
  - `User-Agent` is `mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)`.
- **Valid rate:** a positive decimal in 0.5–1.5; a date no later than tomorrow (UTC).
- **Job:** checks every hour, fetches when there's no rate or the last fetch is over 6 hours old.
  `RATES_SYNC` is `daily` (the default) or `off`.
- **Table:** `exchange_rates(currency text PK CHECK (currency ~ '^[A-Z]{3}$'), per_eur numeric(12,6)
  NOT NULL CHECK (per_eur > 0), rate_date date NOT NULL, fetched_at timestamptz NOT NULL DEFAULT
  now())`, in migration `00007_exchange_rates.sql`.
- **API:** `GET /api/rates` → `{"rates":[{"currency":"GBP","per_eur":0.8712,"date":"2026-10-10"}]}`.
  `rates` is never null.
- **Choice:** stored under `mtgcollector-currency`; `'eur' | 'gbp'`, default EUR.
- **Display:**
  - a converted price is `≈` (aria-hidden) plus a visually hidden "about " plus `roundToCents(eur ×
    rate)` formatted as GBP;
  - USD is never converted;
  - totals convert the server's euro total.
- **Copy:**
  - GBP: "Cardmarket's euro prices in pounds, at the ECB rate of {10 Oct 2026} (€1 = £{0.8712})".
  - GBP chosen, no rate: "Pound prices aren't available yet, so these are in euros."
  - Collection in EUR: "Values from Cardmarket, in euros".
  - The switch: label "Currency", options "EUR" and "GBP".
  - The card price table's header: "GBP (from Cardmarket)" in GBP, "EUR (Cardmarket)" otherwise.
- **Out of scope:** other currencies, rate history, a per-account setting, converting USD.

## Review Focus

- **An unpriced card in GBP mode** still shows the dash ("No price available"), never "≈£0.00".
  The test goes in Task 6.
- **Prices inside dialogs** (the add-card dialog's printings) convert too. Context reaches portals,
  but only if the provider sits above them. The test goes in Task 6.
- **A stale rate** (the ECB unreachable for days) shows its own date in the note, never today's.
  The test goes in Task 7.
- **An ECB file with a comma decimal (`0,8712`), an empty rate, or two GBP entries** is refused,
  not misread. The test goes in Task 1.
- **A partly priced total** reads "≈£x (+N unpriced)" in GBP. The count stays beside the
  converted value. The test goes in Task 6.

---

## File Structure

**Backend:**
- `backend/internal/rates/ecb.go`: `ParseDaily`, plus the ECB HTTP client (`ECB`).
- `backend/internal/rates/rates.go`: `Service`, with `Latest`, `Refresh`, `Due` and `RunDaily`.
- `backend/internal/rates/testdata/eurofxref-daily.xml`: a saved ECB file.
- `backend/internal/db/migrations/00007_exchange_rates.sql`, `backend/internal/db/queries/rates.sql`,
  and the generated `backend/internal/store/rates.sql.go`.
- `backend/internal/contract/contract.go`: `ExchangeRate` and `ExchangeRates`.
- `backend/internal/api/rates.go`: the handler. `api.go` gets the route and `Services.Rates`.
- `backend/cmd/server/main.go`: `RATES_SYNC`, wiring the job and the service.

**Frontend:**
- `frontend/src/lib/currency.ts`: the stored choice.
- `frontend/src/lib/price.ts`: the GBP formatter and `toPounds`.
- `frontend/src/lib/money.ts`: `Money`, `MoneyContext` and `useMoney`.
- `frontend/src/api/endpoints.ts`, `keys.ts`, `queries.ts`: `rates()`, `keys.rates` and `useRates()`.
- `frontend/src/app/MoneyProvider.tsx`, `frontend/src/app/CurrencySwitch.tsx`, and
  `AppLayout.tsx`, which provides the context and shows the switch.
- `frontend/src/components/Price.tsx`, `CardDetail.tsx` and the new `RateNote.tsx`.
- Pages: `CollectionPage.tsx`, `GroupPage.tsx`, `SearchPage.tsx` and `CardPage.tsx`, which place
  `RateNote`.
- `frontend/src/index.css`: the switch's and the note's styles.

---

### Task 1: Parse the ECB file

**Files:**
- Create: `backend/internal/rates/ecb.go`, `backend/internal/rates/testdata/eurofxref-daily.xml`
- Test: `backend/internal/rates/ecb_test.go`

**Interfaces:**
- Produces:
  - `type Rate struct { Currency string; PerEUR float64; Date time.Time }` (Date at UTC
    midnight);
  - `func ParseDaily(r io.Reader, currency string, now time.Time) (Rate, error)`;
  - `var ErrInvalid = errors.New("the ECB's rates file isn't usable")`. Every refusal wraps it
    (`fmt.Errorf("%w: …", ErrInvalid, …)`).

- [ ] **Step 1: Save the test file.** `testdata/eurofxref-daily.xml` is a real ECB file in the
  ECB's own shape: a `gesmes:Envelope` with `Cube` > `Cube time="2026-10-09"`, holding `USD 1.0812`,
  `JPY 161.53` and `GBP 0.8712`.

- [ ] **Step 2: Write the failing tests** (`ecb_test.go`, table-driven where it fits):
  - `TestParseDailyReadsTheGBPRate`: the testdata file at `now` 2026-10-10 gives
    `Rate{Currency:"GBP", PerEUR:0.8712, Date:2026-10-09 UTC}`.
  - `TestParseDailyRefusesUnusableFiles`: each case must be `errors.Is(err, ErrInvalid)`:
    - GBP missing;
    - `rate="0,8712"`;
    - `rate=""`;
    - `rate="0.4"`;
    - `rate="1.6"`;
    - `rate="-1"`;
    - two GBP `Cube`s;
    - no dated `Cube`;
    - `time="2026-10-12"` when `now` is 2026-10-10 (the day after tomorrow);
    - malformed XML.
  - `TestParseDailyAcceptsTomorrow`: `time="2026-10-11"` with `now` 2026-10-10 23:00 UTC parses,
    since ECB time is ahead of UTC.

- [ ] **Step 3: Run them to see them fail.** Run `go -C backend test ./internal/rates/`.
  Expected: FAIL, undefined `ParseDaily`.

- [ ] **Step 4: Implement `ParseDaily`** with `encoding/xml` (structs for
  `Envelope > Cube > Cube[time] > Cube[currency,rate]`, ignoring namespaces). Parse the rate with
  `strconv.ParseFloat(s, 64)` after checking it against `^[0-9]+\.[0-9]+$`. Parse the date with
  `time.Parse("2006-01-02", …)`.

- [ ] **Step 5: Run the tests.** Expected: PASS.

- [ ] **Step 6: Commit** with "Parse the ECB's daily euro rates".

### Task 2: Store the rate and refresh it daily

**Files:**
- Create: `backend/internal/db/migrations/00007_exchange_rates.sql`,
  `backend/internal/db/queries/rates.sql`, `backend/internal/rates/rates.go`
- Modify: `backend/internal/rates/ecb.go` (add the client)
- Generate: `go -C backend generate ./...` (sqlc writes `internal/store/rates.sql.go`)
- Test: `backend/internal/rates/rates_integration_test.go` (`//go:build integration`, using
  `internal/testdb` like the cards importer's tests); `backend/internal/rates/ecb_test.go`

**Interfaces:**
- Consumes: `ParseDaily`, `Rate` and `ErrInvalid` (Task 1).
- Produces:
  - `type Source interface { Daily(ctx context.Context) (Rate, error) }`;
  - `type ECB struct { URL string; Client *http.Client }`. A zero `URL` means the ECB address
    (constant `DailyURL`). `func (e ECB) Daily(ctx) (Rate, error)` fetches with the 10 s timeout,
    the 64 KB cap and the `User-Agent`, then calls `ParseDaily(body, "GBP", time.Now())`.
  - `type Service struct { Pool *pgxpool.Pool; Source Source; Log *slog.Logger }`, with:
    - `func (s *Service) Latest(ctx) ([]contract.ExchangeRate, error)`: never nil, ordered by
      currency;
    - `func (s *Service) Refresh(ctx) error`: fetches and upserts. A fetch error is returned and
      nothing is written.
    - `func (s *Service) Due(ctx, maxAge time.Duration) (bool, error)`: true when there's no row,
      or the newest `fetched_at` is older than `maxAge`.
    - `func (s *Service) RunDaily(ctx, checkEvery time.Duration)`: the importer's loop, with
      `Due(ctx, 6*time.Hour)`; it logs failures with Warn.
  - The sqlc queries:
    - `UpsertExchangeRate` with `(currency, per_eur, rate_date)`. On conflict it always sets
      `fetched_at = now()`, and sets `per_eur`/`rate_date` only `WHERE excluded.rate_date >=
      exchange_rates.rate_date`, done as a `CASE` in the `SET`, so `fetched_at` still moves.
    - `ListExchangeRates`.
    - `LastRateFetch` (`max(fetched_at)`).

- [ ] **Step 1: Write the migration** with the table from Global Constraints, and its `-- +goose
  Down` drop.

- [ ] **Step 2: Write the failing tests:**
  - **`ecb_test.go` (client, against an `httptest.NewServer` passed in as `ECB{URL: srv.URL,
    Client: srv.Client()}`):**
    - `TestECBDailyFetchesAndParses`: the server serves the testdata file, and the request
      carries the `User-Agent`;
    - `TestECBDailyRefusesAnOversizedBody`: 65 KB gives an error;
    - `TestECBDailyRefusesAnErrorStatus`: 503 gives an error.
  - **`rates_integration_test.go` (with a fake `Source`):**
    - `TestRefreshStoresTheRate`: `Latest` is `[]` before the refresh, then
      `[{GBP 0.8712 "2026-10-09"}]`.
    - `TestAnOlderFileDoesntReplaceANewerRate`: refresh 2026-10-09 at 0.8712, then 2026-10-08 at
      0.85. `Latest` still has 0.8712 and 2026-10-09, but `fetched_at` moved (`Due(ctx, time.Hour)`
      is false).
    - `TestAFailedFetchKeepsTheLastRate`: refresh, then a `Source` returning `ErrInvalid` makes
      `Refresh` return the error, and `Latest` is unchanged.
    - `TestDue`: true with no rows; false right after a refresh with `maxAge` 6h; true with
      `maxAge` 0.

- [ ] **Step 3: Run them to see them fail.** Run `go -C backend test ./internal/rates/` and
  `go -C backend test -tags=integration ./internal/rates/` (with `TEST_DATABASE_URL` set). Expected:
  FAIL, undefined.

- [ ] **Step 4: Implement** the queries in `rates.sql`, run `go -C backend generate ./...`, then
  write `ECB.Daily` and `Service`.

- [ ] **Step 5: Run both test commands.** Expected: PASS.

- [ ] **Step 6: Commit** with "Store the ECB's GBP rate and refresh it daily".

### Task 3: Serve the rate at GET /api/rates

**Files:**
- Modify: `backend/internal/contract/contract.go` (add the types to the tygo list too),
  `backend/internal/api/api.go`, `backend/cmd/server/main.go`, and `README.md` (the endpoint
  table and the `RATES_SYNC` setting)
- Create: `backend/internal/api/rates.go`
- Generate: `go -C backend generate ./...` (tygo updates `frontend/src/types.ts`)
- Test: `backend/internal/contract/contract_test.go`, `backend/internal/api/rates_test.go`,
  `backend/internal/api/api_integration_test.go`, `backend/cmd/server` (config test, if one exists
  for `SCRYFALL_SYNC`)

**Interfaces:**
- Consumes: `rates.Service.Latest` and `RunDaily` (Task 2).
- Produces:
  - Go: `contract.ExchangeRate { Currency string json:"currency"; PerEUR float64 json:"per_eur";
    Date string json:"date" }` and `contract.ExchangeRates { Rates []ExchangeRate json:"rates" }`.
  - TypeScript: `ExchangeRate` and `ExchangeRates` in `types.ts`.
  - The API: `api.Rates interface { Latest(ctx context.Context) ([]contract.ExchangeRate, error)
    }`, the field `Services.Rates`, and the route `mux.HandleFunc("GET /api/rates", rates(s.Rates))`
    (public).
  - The server: `Config.DailyRates bool`, from `RATES_SYNC`.

- [ ] **Step 1: Write the failing tests:**
  - **Contract:** `TestJSONEncodingMatchesTheTypeScript` gains `ExchangeRates` with one rate, and
    asserts `per_eur` is a JSON number and `date` matches `^\d{4}-\d{2}-\d{2}$`. A
    `{"rates":[]}` case checks it encodes as `[]`, not `null`.
  - **`rates_test.go`:**
    - `TestRatesServesTheLatest`, with a fake `Rates`: 200 and the body above.
    - `TestRatesWithNoneYetIsAnEmptyList`: `{"rates":[]}`.
    - `TestRatesFailingIsA503`: an error from `Latest` gives a 5xx with an `{"error":…}` body, in
      the way the other handlers map database errors.
  - **Integration:** `GET /api/rates` without a session gives 200 (public).
  - **Server config:** `RATES_SYNC` of `off` gives `DailyRates` false; unset or `daily` gives true;
    `x` is an error that names the variable.

- [ ] **Step 2: Run them to see them fail.** Run `go -C backend test ./...` and the integration
  tags. Expected: FAIL.

- [ ] **Step 3: Implement:**
  - the types, plus the tygo entry, then run `go -C backend generate ./...`;
  - the handler, the route and the field;
  - `cmd/server`: when `DailyRates` is set, `svc := &rates.Service{Pool: pool, Source: rates.ECB{},
    Log: slog.Default()}` and `wg.Go(func() { svc.RunDaily(ctx, syncCheckEvery) })`;
    `Services.Rates = svc` either way;
  - the README: a `GET /api/rates` row, and `RATES_SYNC` beside `SCRYFALL_SYNC`.

- [ ] **Step 4: Run the tests and `./scripts/verify.sh`** (the stale-types check must pass).
  Expected: PASS.

- [ ] **Step 5: Commit** with "Serve the GBP rate at GET /api/rates".

### Task 4: The stored currency choice and the conversion

**Files:**
- Create: `frontend/src/lib/currency.ts`, `frontend/src/lib/currency.test.ts`
- Modify: `frontend/src/lib/price.ts`, `frontend/src/lib/price.test.ts`

**Interfaces:**
- Produces:
  - `type DisplayCurrency = 'eur' | 'gbp'`;
  - `storedCurrency(storage?: Pick<Storage,'getItem'>): DisplayCurrency`;
  - `saveCurrency(c: DisplayCurrency, storage?: Pick<Storage,'setItem'>): void`;
  - `onCurrencyChanged(cb: (c: DisplayCurrency) => void): () => void`.
  - All of these copy `lib/theme.ts`'s pattern exactly: storage is read inside the try, and blocked
    storage gives `'eur'`.
  - In `price.ts`: `Currency` becomes `'eur' | 'usd' | 'gbp'`, with a GBP formatter, and
    `toPounds(eur: number, gbpPerEur: number): number` returns `roundToCents(eur * gbpPerEur)`.

- [ ] **Step 1: Write the failing tests:**
  - **`currency.test.ts`:** cover the same cases as `theme.test.ts`. A value other than `'gbp'`
    gives `'eur'`; a throwing `localStorage` getter gives `'eur'`; `saveCurrency` with a throwing
    `setItem` doesn't throw.
  - **`price.test.ts`:**
    - `toPounds(2.06, 0.8712)` is `1.79` (1.794672 rounds down);
    - `toPounds(1.005, 1)` is `1.01` (half up);
    - `formatPrice(1.8, 'gbp')` contains `£` and `1.80`.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/lib/currency.test.ts
  src/lib/price.test.ts` in `frontend/`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit** with "Remember the chosen currency; convert euros to pounds".

### Task 5: The rate in the app, and the switch

**Files:**
- Create: `frontend/src/lib/money.ts`, `frontend/src/app/MoneyProvider.tsx`,
  `frontend/src/app/CurrencySwitch.tsx`, `frontend/src/app/CurrencySwitch.test.tsx`
- Modify:
  - `frontend/src/api/endpoints.ts`, `keys.ts`, `queries.ts`;
  - `frontend/src/app/AppLayout.tsx`;
  - `frontend/src/index.css` (`.currency-switch` beside `.theme-toggle`; compact under `40rem`);
  - `frontend/src/test/app.tsx`: `ratesApi: Routes` gives `'GET /api/rates': { body: { rates:
    [{ currency: 'GBP', per_eur: 0.8712, date: '2026-10-09' }] } }`, for page tests to spread in.

**Interfaces:**
- Consumes: `storedCurrency`, `saveCurrency` and `onCurrencyChanged` (Task 4); the `ExchangeRates`
  type (Task 3).
- Produces:
  - `endpoints.rates(signal?): Promise<ExchangeRates>`;
  - `keys.rates = ['rates'] as const`;
  - `useRates()`, with `staleTime: 60 * 60_000`;
  - in `lib/money.ts`: `interface Money { chosen: DisplayCurrency; currency: DisplayCurrency;
    gbpPerEur: number | null; rateDate: string | null; choose: (c: DisplayCurrency) => void }`.
    `currency` is `'gbp'` only when it's chosen and a GBP rate is known. Also `MoneyContext`
    (defaults: `chosen` and `currency` `'eur'`, the rest null, `choose` a no-op) and `useMoney()`.
  - `MoneyProvider({ children })`: it holds `chosen` (starting from `storedCurrency()` and
    following `onCurrencyChanged`), with `choose` calling `saveCurrency`.
  - `AppLayout` wraps the header and `<Outlet/>` in `MoneyProvider`.
  - `CurrencySwitch`: a `SegmentedControl` labelled "Currency", options `EUR`/`GBP`, className
    `currency-switch`.

- [ ] **Step 1: Write the failing tests** (`CurrencySwitch.test.tsx`, through
  `renderApp('/search', { ...signedOut, ...ratesApi })`; `afterEach` clears `localStorage`):
  - `"starts on EUR, and remembers GBP once chosen"`: radio `EUR` is checked; clicking `GBP` checks
    it, and `localStorage['mtgcollector-currency']` is `'gbp'`.
  - `"starts from the stored choice"`.
  - `"follows a choice made in another tab"`: a `StorageEvent` checks `GBP`.
  - `"asks for the rate once, without signing in"`: `api.sent('GET /api/rates')` has length 1.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (no "Currency" group).

- [ ] **Step 3: Implement.** Make sure the existing App and page tests that count requests or
  check `api.unhandled` still pass: spread `ratesApi` into their routes, or have `renderApp`
  answer `/api/rates` by default. Prefer the default, so no other test changes.

- [ ] **Step 4: Run the whole frontend suite.** Run `npx vitest run --maxWorkers=4`. Expected: PASS.

- [ ] **Step 5: Commit** with "Add the currency switch and fetch the GBP rate".

### Task 6: Prices and totals in pounds

**Files:**
- Modify: `frontend/src/components/Price.tsx`, `frontend/src/components/CardDetail.tsx`
- Test: `frontend/src/components/Price.test.tsx` (create if it doesn't exist; otherwise use the
  file that tests `Price`), `frontend/src/pages/CollectionPage.test.tsx`,
  `frontend/src/pages/SearchAndCard.test.tsx`

**Interfaces:**
- Consumes: `useMoney` (Task 5), and `toPounds` and `formatPrice` (Task 4).
- Produces:
  - `Price` reads `useMoney()`. When its `currency` prop is `'eur'` (the default) and
    `money.currency === 'gbp'`, it renders `<data className="price price--gbp"
    value={pounds}><span aria-hidden="true">≈</span><VisuallyHidden>about </VisuallyHidden>{£…}</data>`.
  - `'usd'` and `null` amounts are unchanged.
  - The `CardDetail` price column header follows `useMoney().currency`.

- [ ] **Step 1: Write the failing tests:**
  - **`Price` (wrapped in `MoneyContext.Provider` with `currency: 'gbp', gbpPerEur: 0.8712`):**
    - `<Price value={2.06} />` has text `≈£1.79` and accessible text "about £1.79"
      (`toHaveTextContent` on the visually hidden part);
    - `<Price value={null} />` still shows `—` and the "No price available" tooltip;
    - `<Price prices={…} currency="usd" />` is unchanged;
    - with `currency: 'eur'`, the euro amount shows with no `≈`.
  - **`TotalValue` in GBP:** a partly priced total reads `≈£… (+N unpriced)`.
  - **Collection page, GBP stored, `ratesApi`:**
    - each tile's value and the summary's value show `≈£` with the converted amount
      (`toPounds(entry.value_eur!, 0.8712)`);
    - the unpriced entry still shows `—`.
  - **Search:** a result's price is `≈£`.
  - **Add dialog:** after opening Add, a printing's price in the dialog is `≈£`.
  - **Card page:** the price table header is "GBP (from Cardmarket)", and the USD column is
    unchanged.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the whole frontend suite.** Expected: PASS.

- [ ] **Step 5: Commit** with "Show prices and totals in pounds when GBP is chosen".

### Task 7: Say where the pounds come from

**Files:**
- Create: `frontend/src/components/RateNote.tsx`, `frontend/src/components/RateNote.test.tsx`
- Modify: `frontend/src/pages/CollectionPage.tsx` (it replaces the subtitle), `GroupPage.tsx`
  (under the header), `SearchPage.tsx` (above the results grid), `CardPage.tsx` or `CardDetail.tsx`
  (the prices section), `frontend/src/pages/ComponentGallery.tsx` (a `RateNote` section, plus GBP
  `Price` examples in the Price section), and `frontend/src/index.css`
- Test: `RateNote.test.tsx`, plus one page test for each placement

**Interfaces:**
- Consumes: `useMoney` (Task 5).
- Produces: `RateNote({ euros?: string; className?: string })`, rendered as `<p
  className="rate-note …">`:
  - when GBP is in effect, the GBP copy, with the date as `Intl.DateTimeFormat('en-GB', { day:
    'numeric', month: 'short', year: 'numeric' })` (2026-10-09 gives "9 Oct 2026") and the rate as
    given (`0.8712`);
  - when GBP is chosen but there's no rate, the fallback copy;
  - in EUR, `euros` if given, otherwise nothing (`null`).

- [ ] **Step 1: Write the failing tests:**
  - **`RateNote` (a provider with each state):**
    - GBP: the exact text "Cardmarket's euro prices in pounds, at the ECB rate of 9 Oct 2026 (€1 =
      £0.8712)";
    - chosen without a rate: "Pound prices aren't available yet, so these are in euros.";
    - EUR with `euros`: that text; EUR without it: nothing.
    - **Stale rate:** `rateDate` "2026-09-01" shows "1 Sep 2026", whatever today is.
  - **Collection:** the subtitle reads "Values from Cardmarket, in euros" in EUR, and the GBP copy
    in GBP.
  - **When `/api/rates` fails (500) with GBP stored:** the fallback copy shows, and prices are in
    euros (no `≈`).
  - **Group page, search and card page:** each shows the GBP copy once in GBP, and nothing in EUR.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement, and place the note on the four pages.**

- [ ] **Step 4: Run the whole frontend suite, lint and `tsc -b`.** Expected: PASS.

- [ ] **Step 5: Check it in headless Edge** against the built app, with a GBP row inserted in the
  scratch database's `exchange_rates`:
  - the switch on desktop and at 390 px wide, in dark and light, with screenshots;
  - prices and totals show `≈£`;
  - the note shows on each page;
  - no console errors.

- [ ] **Step 6: Commit** with "Note where the pounds come from on each page".
