# Search the Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search box in the listing toolbar that narrows the collection (and a custom group's page)
to the cards whose name or type line holds every word typed.

**Architecture:**
- **Server:** the four listing endpoints take `q`. The collection service turns it into one ILIKE
  pattern per word and adds one condition to `GroupTotals` and the four `EntriesBy*` queries, so
  group totals, pages and cursors are all over the matches only.
- **App:** `q` joins the listing's URL parameters and query keys. `ListingControls` gets a
  `SearchInput` between Sort by and View. While only the search changes, the listing keeps the last
  results up.

**Tech Stack:** Go (net/http, pgx/v5, sqlc); React 19, TanStack Query 5, React Aria Components,
Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-collection-search-design.md`

## Global Constraints

- **Match:** an entry matches when every whitespace-separated word appears, ignoring case, in
  `concat_ws(' ', name, type_line)`. `%`, `_` and `\` are literal. An empty query matches everything.
- **Limits:** `q` is at most `contract.MaxSearchLength` (150) characters, with no NUL; otherwise 400.
- **Cursor:** a `q` field (omitted when there's no search) holds a digest of the words. A mismatch
  is the existing "that cursor isn't one this listing gave" 400. `cursorVersion` stays 1.
- **URL:** `?q=`, trimmed, whitespace runs collapsed to one space, left out when empty.
- **Requests:** `q` is sent only when non-empty, so requests without a search are unchanged.
- **Copy:**
  - the field label is "Search" and the placeholder "Name or type";
  - the collection's empty state reads "No cards match “{q}”", body "Check the spelling, or clear
    the search.";
  - a group's empty state reads "No cards in {group name} match “{q}”", with the same body;
  - the status reads `${countOf(n, 'card')} match` (`matches` for 1), or "No cards match".
- **Unchanged:** the collection's totals (`/api/collection/stats`), and every endpoint's answer
  without `q`.
- **Tests:** never hard-code formatted prices or numbers (CI runs under a German locale). Build
  them with `formatPrice`, `countOf` or `src/test/helpers.ts`.

## Review Focus

- **Typing on while the last report's URL write lands:** the box must not restart and lose the
  text typed since. The test goes in Task 4.
- **Changing an entry while searching** (e.g. deleting one from its Actions menu): the refresh
  must refetch the searched listing with its `q`, not the unsearched one. The test goes in Task 5.
- **Characters that mean something in a URL** (`R&D's +1 #2`): they must reach the server as
  typed. The test goes in Task 3.
- **A lower-case non-ASCII word** ("æther") should find "Æther Vial". If the test database's
  ctype can't fold it, record that in the spec's known limit rather than skip the test. The test
  goes in Task 2.
- **Clearing the box (×)** must bring back the whole listing and drop `?q=` from the URL. The test
  goes in Task 5.

---

## File Structure

**Backend:**
- **Create** `backend/internal/collection/search.go`: parses `q` into patterns and a digest.
- **Modify:**
  - `listing.go`, `cursor.go`, `customgroups.go`: thread the search through.
  - `backend/internal/db/queries/collection.sql`, plus the generated `backend/internal/store/collection.sql.go`.
  - `backend/internal/cards/search.go`: export the pattern helper.
  - `backend/internal/api/collection.go`, `groups.go`: read `q`.
  - `README.md`: the endpoint table.

**Frontend:**
- **Modify (data):**
  - `src/lib/listingParams.ts`: `q`.
  - `src/api/endpoints.ts`, `keys.ts`, `queries.ts`: `q` in requests and keys; keep the last results.
- **Modify (toolbar):**
  - `src/components/ListingControls.tsx`: the search field.
  - `src/index.css`: its layout, wide and phone.
  - `src/pages/ComponentGallery.tsx`.
- **Modify (pages):**
  - `src/pages/Listing.tsx`: sections use the groups' own `q`; busy state and status.
  - `src/pages/CollectionPage.tsx`, `src/pages/GroupPage.tsx`: the no-match empty states.

---

### Task 1: Parse a search, and carry it in cursors

**Files:**
- Create: `backend/internal/collection/search.go`
- Modify: `backend/internal/collection/cursor.go`, `backend/internal/collection/listing.go` (`EntryQuery`)
- Modify: `backend/internal/cards/search.go` (rename `containsEach` → `ContainsEach`, keeping the
  doc comment; update its callers)
- Test: `backend/internal/collection/collection_test.go`

**Interfaces:**
- **Produces:**
  - `EntryQuery.Search string`: the raw `q`.
  - The unexported `EntryQuery.search search`, set by `listing()`.
  - `type search struct { patterns []string; digest string }`
  - `func parseSearch(q string) (search, error)`
  - The `cursor` field `Search string \`json:"q,omitempty"\``.
  - `cards.ContainsEach(words []string) []string`

- [ ] **Step 1: Write the failing tests** in `collection_test.go`:
  - `TestASearchIsAPatternForEachWord`, table-driven:
    - `""` and `"  \t "` give `patterns` of length 0 (non-nil) and `digest ""`;
    - `"bolt  Light"` gives `[]string{"%bolt%", "%Light%"}`;
    - `"100%_a\\b"` gives `[]string{`%100\%\_a\\b%`}`;
    - `" bolt light "` and `"bolt light"` have the same non-empty digest, and `"bolt"` a different one.
  - `TestASearchTheServerCantRunIsRefused`:
    - 151 `"a"`s, and `"bolt\x00"`, each give an `apperr.Invalid` error;
    - 150 multi-byte runes (`strings.Repeat("é", 150)`) are accepted, because the cap is in
      characters, not bytes.
  - Extend `TestACursorIsOnlyForItsListing`: a cursor made with `q.search = parseSearch("goblin")`
    is refused for the same query searched `"elf"`, and for the same query with no search. A
    cursor made with no search is accepted with no search.
  - Extend `TestACursorComesBackAsItWasMade` with a searched query.

- [ ] **Step 2: Run them and see them fail**

  Run: `go -C backend test ./internal/collection -run 'Search|Cursor'`
  Expected: build failure (`parseSearch` undefined).

- [ ] **Step 3: Implement `parseSearch`**
  - Check the length with `utf8.RuneCountInString` against `contract.MaxSearchLength`. The
    message is `invalid("a search can be at most %d characters", contract.MaxSearchLength)`.
  - Refuse NUL with `invalid("a search can't contain the character NUL")`.
  - Split with `strings.Fields`, and make the patterns with `cards.ContainsEach`.
  - The digest is the FNV-1a 64-bit hash of `strings.Join(words, " ")`, as 16 hex digits, or `""`
    for no words.
  - In `cursor.go`:
    - `cursorAfter` sets `Search: q.search.digest`;
    - `decodeCursor` adds `c.Search != q.search.digest` to its mismatch check.

- [ ] **Step 4: Run them and see them pass**

  Run: `go -C backend test ./internal/collection ./internal/cards`
  Expected: `ok` for both.

- [ ] **Step 5: Commit**

  `git commit -m "Parse a collection search, and keep cursors to their search"` (with the
  Co-Authored-By line).

---

### Task 2: Narrow the listings by the search, through the API

**Files:**
- Modify:
  - `backend/internal/db/queries/collection.sql`: `GroupTotals`, `EntriesByName`, `EntriesByPrice`,
    `EntriesByCMC`, `EntriesByAdded`.
  - The generated `backend/internal/store/collection.sql.go`.
  - `backend/internal/collection/listing.go`, `customgroups.go`.
  - `backend/internal/api/collection.go`, `groups.go`.
  - `README.md`: the four listing rows of the endpoint table, plus one sentence giving the matching
    rule.
- Test:
  - `backend/internal/collection/collection_integration_test.go`, `customgroups_integration_test.go`;
  - `backend/internal/api/collection_test.go`, `groups_test.go` (the fakes and the
    parameter-passing tests).

**Interfaces:**
- **Consumes:** `parseSearch`, `EntryQuery.Search` and `EntryQuery.search` (Task 1).
- **Produces:**
  - `Service.Groups(ctx, userID int64, by contract.GroupBy, q string)`
  - `Service.GroupGroups(ctx, userID, groupID int64, by contract.GroupBy, q string)`
  - The same signatures on the `api.Collection` and `api.CustomGroups` interfaces.
  - Each handler reads `r.URL.Query().Get("q")`: `entryQuery` sets `Search`, and the two group
    handlers pass it.
  - The sqlc param `SearchPatterns []string` on all five queries.

- [ ] **Step 1: Write the failing tests**
  - **Integration (collection).** Use a fixture of ann's cards: "Goblin Guide" (Creature — Goblin
    Scout), "Lightning Bolt" (Instant), "Llanowar Elves" (Creature — Elf Druid), "100% Juice"
    (Instant), "Æther Vial" (Artifact). Give bob a "Goblin King".
    - `TestASearchNarrowsTheEntries`, as a table of `q` to the names expected, every sort:
      - `goblin` gives Goblin Guide only (never bob's);
      - `bolt light` gives Lightning Bolt;
      - `llanowar druid` gives Llanowar Elves;
      - `GOBLIN` gives Goblin Guide;
      - `100%` gives 100% Juice;
      - `_` gives nothing;
      - `æther` gives Æther Vial;
      - `zzz` gives nothing;
      - `""` gives all five.
    - `TestASearchPagesThroughItsMatchesOnly`: `PageSize+1` cards typed "Creature — Goblin" and 5
      others. For each sort, following `NextCursor` gives exactly the goblins, each once, in the
      sort's order.
    - `TestASearchNarrowsTheGroups`:
      - by color, `goblin` gives only red's group, whose `EntryCount`, `CardCount` and
        `ValueEUR` are the goblins' alone;
      - by none, `zzz` gives the one `all` group with zero totals.
  - **Integration (custom groups).** `TestASearchNarrowsAGroupsMembers`: `Members` and
    `GroupGroups` with `goblin` give only the group's goblins.
  - **API.**
    - `TestListingsPassTheirParametersOn` gets `&q=goblin` on groups (assert `c.q == "goblin"`)
      and on entries (`want` gains `Search: "goblin"`).
    - The group handlers' test does the same for `/api/groups/1/groups` and `/members`.

- [ ] **Step 2: Run them and see them fail**

  Run: `go -C backend test ./internal/api ./internal/collection` (with `TEST_DATABASE_URL` set
  as in `scripts/verify.sh`).
  Expected: build failures (signatures).

- [ ] **Step 3: Add the condition**
  - In each of the five queries, after the `user_id` condition, add:
    `AND concat_ws(' ', p.name, p.type_line) ILIKE ALL (@search_patterns::text[])`
  - Regenerate with `go -C backend tool -modfile=tools/go.mod sqlc generate`.

- [ ] **Step 4: Thread the search through**
  - `listing()` calls `parseSearch(q.Search)` before `checkKey`, and sets `q.search`.
  - `page()` passes `SearchPatterns: q.search.patterns`.
  - `groupsOf` gains `q string`: it parses, then passes the patterns to `GroupTotals`.
  - Then update the api interfaces, handlers and fakes.

- [ ] **Step 5: Run them and see them pass**

  Run: `go -C backend test ./...`, then `go -C backend tool -modfile=tools/go.mod sqlc diff`.
  Expected: all `ok`, and no sqlc diff.
  - If `æther` fails only because the database ctype is `C`, keep the test asserting today's
    behaviour, with a comment, and add the case to the spec's known limit.

- [ ] **Step 6: Commit**

  `git commit -m "Narrow the collection's and groups' listings by a search"`

---

### Task 3: Search in the listing's URL, requests and cache

**Files:**
- Modify: `frontend/src/lib/listingParams.ts`, `frontend/src/api/endpoints.ts`,
  `frontend/src/api/keys.ts`, `frontend/src/api/queries.ts`, plus each caller of the changed
  hooks (`Listing.tsx`; the type checker lists them).
- Test: `frontend/src/lib/listingParams.test.ts`, `frontend/src/api/queries.test.tsx`

**Interfaces:**
- **Produces:**
  - `ListingParams.q: string` (default `''`).
  - `ListingPage.q: string`.
  - `collectionGroups(groupBy, q, signal?)` and `groupGroups(id, groupBy, q, signal?)`.
  - `keys.listingGroups(id, groupBy, q)` and `keys.listingEntries(id, groupBy, key, sort, q)`,
    with `q` last.
  - `interface ListingGroups extends CollectionGroups { q: string }`
  - `useListingGroups(id, groupBy, q): UseQueryResult<ListingGroups>`
  - `useListingEntries(id, groupBy, key, sort, q, enabled)`

- [ ] **Step 1: Write the failing tests**
  - **`listingParams.test.ts`:**
    - `?q=` is read as given;
    - a missing `q` is `''`;
    - `writeListing` with `q: '  goblin   king '` writes `q=goblin+king`;
    - `q: ''` removes `q`, and other params are kept.
  - **`queries.test.tsx`:**
    - `useListingGroups` sends `q` only when non-empty;
    - `R&D's +1 #2` arrives intact in `req.query.get('q')`;
    - its data's `q` is the search it was fetched for.
    - A rerender with a new `q` keeps the previous data (`isPlaceholderData` true) until the new
      answer.
    - A rerender with a new `groupBy` or listing id does not (`data` undefined while loading).
    - The same two cases for `useListingEntries`.

- [ ] **Step 2: Run them and see them fail**

  Run (in `frontend/`): `npx vitest run src/lib/listingParams.test.ts src/api/queries.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - `listingQuery` and the group requests add `q` only when it isn't `''`.
  - Both hooks use `placeholderData: (prev, prevQuery) => (prevQuery && onlySearchChanged(prevQuery.queryKey, queryKey) ? prev : undefined)`.
  - `onlySearchChanged(a, b)` (in `queries.ts`) says whether the keys are equal in every element
    but the last.
  - `useListingGroups`'s `queryFn` returns `{ ...answer, q }`.
  - Callers pass `params.q` for now; Task 5 changes `Listing`.

- [ ] **Step 4: Run them and see them pass**

  Run (in `frontend/`): `npx vitest run src/lib src/api`, then `npx tsc -b`.
  Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

  `git commit -m "Keep a listing's search in its URL, requests and cache"`

---

### Task 4: The search box in the toolbar

**Files:**
- Modify: `frontend/src/components/ListingControls.tsx`, `frontend/src/index.css`,
  `frontend/src/pages/ComponentGallery.tsx`
- Test: `frontend/src/components/Forms.test.tsx` (where `ListingControls` is tested)

**Interfaces:**
- **Consumes:** `ListingParams.q` (Task 3).
- **Produces:**
  - `ListingControls` renders `<Field label="Search" className="listing-controls__search">` with
    `SearchInput`, between Sort by and View.
  - It reports a trimmed, collapsed `q` through `onChange({ ...value, q })`.

- [ ] **Step 1: Write the failing tests**
  - `the search box sits between Sort by and View`: the order of the labelled controls is Group
    by, Sort by, Search, View.
  - `reports a search once typing pauses, trimmed`: type ` goblin ` and await `onChange` with
    `q: 'goblin'` and the other params unchanged.
  - `starts afresh when the value changes from outside`: rerender with `q: 'elf'` (not reported
    by the box), and the box shows `elf`.
  - `keeps what's typed when its own report comes back late`:
    - type `gob`, wait for the report, then type `lin`;
    - only then rerender with `q: 'gob'` (the URL catching up);
    - the box still shows `goblin`, and then reports `goblin`.
  - `holds at most MaxSearchLength characters`: the input has `maxLength` equal to
    `MaxSearchLength`.

- [ ] **Step 2: Run them and see them fail**

  Run (in `frontend/`): `npx vitest run src/components/Forms.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - The box restarts by `key`, following `SearchPage`'s "own write" approach:
    - state `{ key, q, own }`;
    - when `value.q !== state.q`, accept it silently if it equals `own`, else bump `key`;
    - a report sets `own`.
  - **CSS, wide screens:** `.listing-controls__search` takes `flex: 1 1 12rem; max-width: 22rem`,
    and its input fills the field.
  - **CSS, phone** (the existing toolbar media query): `flex-basis: 100%`.
  - Use only existing tokens.
  - The gallery's `ListingControls` section works unchanged: its state now includes `q`.

- [ ] **Step 4: Run them and see them pass**

  Run (in `frontend/`): `npx vitest run src/components src/pages/ComponentGallery.test.tsx`, then
  `npm run lint`.
  Expected: PASS, with no warnings.

- [ ] **Step 5: Commit**

  `git commit -m "Put a search box in the listing toolbar"`

---

### Task 5: Search results on the collection and group pages

**Files:**
- Modify: `frontend/src/pages/Listing.tsx`, `frontend/src/pages/CollectionPage.tsx`,
  `frontend/src/pages/GroupPage.tsx`
- Test: `frontend/src/pages/CollectionPage.test.tsx`, `frontend/src/pages/GroupPages.test.tsx`

**Interfaces:**
- **Consumes:** `useListingGroups(...).data.q` and `isPlaceholderData` (Task 3); the toolbar
  (Task 4).

- [ ] **Step 1: Write the failing tests**
  - **`CollectionPage.test.tsx`.** Give the fake routes a `q` filter: by `card.name` or
    `card.type_line`, every word.
    - `narrows the listing to the cards that match`:
      - type a fixture card's type word;
      - the groups and entries requests carry it;
      - only the matching tiles show;
      - the URL has `?q=`.
    - `says when no cards match`:
      - search `zzz`, and the "No cards match “zzz”" empty state shows;
      - "Your collection is empty" does not.
    - `sends the search with the cursor for more`: a paged answer's "Show more" request has both
      `q` and `cursor`.
    - `searches within the chosen grouping`: with `?group_by=color&q=…`, only the matching colour
      groups show.
    - `announces how many cards match`: the status reads `${countOf(n, 'card')} match`.
    - `keeps the last results up while the next search loads`:
      - delay the second answer;
      - the earlier tiles stay, the listing is `aria-busy`, and then the new results replace them.
    - `clearing the search brings every card back` (Review Focus): press the box's clear button;
      all tiles return and `?q` is gone.
    - `a change refreshes the searched listing` (Review Focus): delete an entry while searching,
      and the refetched groups request carries `q`.
    - `the nav link to the collection starts the search afresh`: from `?q=goblin`, click "Your
      collection"; the box is empty and every card shows.
  - **`GroupPages.test.tsx`.** `a group's cards can be searched`:
    - the members and groups requests carry `q`;
    - `zzz` shows "No cards in {name} match “zzz”".

- [ ] **Step 2: Run them and see them fail**

  Run (in `frontend/`): `npx vitest run src/pages/CollectionPage.test.tsx src/pages/GroupPages.test.tsx`
  Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`Listing`:**
    - sections take `q` from `groups.data.q`;
    - the `.listing` wrapper gets `aria-busy` while `groups.isPlaceholderData`;
    - a `<p role="status" className="visually-hidden">` is rendered in every state (empty
      included), so the live region exists before its text changes. It's empty when not
      searching, and holds the status copy once a search's groups are not placeholder data.
  - **Pages:** each passes `empty` by `listing.q`, with the copy from Global Constraints.

- [ ] **Step 4: Run them and see them pass**

  Run (in `frontend/`): `npx vitest run`
  Expected: PASS.

- [ ] **Step 5: Commit**

  `git commit -m "Show a search's results, and say when nothing matches"`

---

### Task 6: Check it in the browser, then the full gate

- [ ] **Step 1:** Run the app with the dev servers. Search, page and group, in both themes, at
  desktop and phone (375 px) width. The box sits between Sort by and View, with no horizontal
  scroll, and the sticky section headings sit below the toolbar. Screenshot each state.
- [ ] **Step 2:** Run `bash scripts/verify.sh`. Expected: it ends with verify passed.
- [ ] **Step 3:** Add to the project plan (`C:\Users\mello\.claude\plans\i-m-looking-to-develop-witty-leaf.md`):
  - this ad hoc feature;
  - its deferred items: accent folding; set-name search; and, if the user chose
    collection-only, the group page.
  - Mark the collection branch's deferred "name and other filters on the entries listing" as done.
- [ ] **Step 4:** If PR #22 has merged by now, rebase onto `origin/develop` and run Step 2 again.
- [ ] **Step 5:** Review before pushing:
  - run `/code-review` and adversarial reviewer subagents over the branch;
  - fix each finding or rebut it;
  - run Step 2 again after any fix.
- [ ] **Step 6:** Push and open the pull request.
  - Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=10" git push -u origin feature/collection-search`.
    The pre-push hook runs the full verify (about 10 minutes).
  - Confirm the branch is on GitHub, then open the PR into `develop` with `gh pr create`.
