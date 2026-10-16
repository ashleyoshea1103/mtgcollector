# Search the collection: design

Agreed with the user on 2026-10-15 (search on both the collection and group pages); updated after
the review. Branch: `feature/collection-search`, off `develop`.

## Goal

A search box in the collection page's toolbar. Typing in it narrows the listing to the matching
cards, in whatever grouping and order are chosen.

## Where the search runs: the server

The listing is paged on the server. `GET /api/collection/groups` gives each group's counts and
value, and each open section fetches its entries 60 at a time, by keyset cursor. If the browser
did the filtering, it could only filter the pages already loaded. Closed sections would not be
filtered at all, and the group headings' counts and values would still be for every card. So the
server narrows the groups and the pages, and paging, totals and the "Show more" button all stay
correct.

## What matches

**Rule:** split the query into words at whitespace. An entry matches when **every word appears,
ignoring case, in its card's name or its type line**.
- Words can be in any order, and part of a word is enough: "bolt light" finds Lightning Bolt,
  "gob" finds Goblins.
- One word can match the name and another the type line: "llanowar druid" finds Llanowar Elves
  (Creature — Elf Druid).
- `%`, `_` and `\` match themselves.
- Curly apostrophes (as phones type them) match the straight ones card names use: "urza’s"
  finds Urza's Saga.
- A dash on its own is ignored: "creature - goblin" finds goblins, whose type lines use "—".
- An empty or all-whitespace query matches everything.

This is the card search's rule for names (`internal/cards/search.go`), extended to the type line.

**Why the type line:** the "Type" grouping only sorts by card type (creature, instant, …). The
search is how to find subtypes and supertypes: "goblin", "equipment", "legendary".

**Left out, and why:**
- **Set name and set code.** "Group by: Set" already does this. Set names would also flood
  ordinary searches: "dragon" would bring up every card in Dragons of Tarkir.
- **Rules text.** No entry view shows it, so its matches would look unexplained.
- **Rarity and colour.** The groupings cover these.

**Known limit:** like the card search, it doesn't fold accents ("lim-dul" doesn't find
Lim-Dûl). Most Scryfall names are plain ASCII.

## API

A `q` parameter is added to the four listing endpoints:
- `GET /api/collection/groups`
- `GET /api/collection/entries`
- `GET /api/groups/{id}/groups`
- `GET /api/groups/{id}/members`

Without `q`, every endpoint answers exactly as it does now.

- **Groups:** counts, card counts and values are over the matching entries only. Groups with no
  match are left out, except for `none`'s one group, `all`, which stays with zero totals (as for
  an empty collection).
- **Pages:** only matching entries, in the chosen order, paged as before.
- **Refused with 400:**
  - `q` longer than `MaxSearchLength` (150 characters, as for the card search);
  - `q` with a NUL character (Postgres text can't hold one);
  - `q` that isn't UTF-8 (Postgres refuses such text, which would be a 500).
- **Cursor:** it carries a short hash of the search's words, so a cursor made for one search is
  refused with another, as a cursor for another group or order is now. A cursor with no search
  is unchanged, so `cursorVersion` stays 1.

**Backend shape:**
- `collection.EntryQuery` gains `Search`.
- `Service.Groups` and `Service.GroupGroups` take the search too.
- One function turns `q` into ILIKE patterns, one per word, escaped. It reuses the card search's
  escaping, exported from `internal/cards`.
- `GroupTotals` and the four `EntriesBy*` queries get one condition: no patterns, or
  `lower(concat_ws(' ', p.name, p.type_line) COLLATE "unicode")` `LIKE ALL` the patterns,
  lowered the same way.
  - Words never hold whitespace, so no word can match across the join.
  - Each row is lowered once. (The first version used ILIKE, which lowers the row again for every
    pattern: 2.1 s against 0.17 s for 75 one-letter words over 50,000 rows.)
  - The "unicode" collation lowers every letter, whatever the database's own ctype (which may
    lower only A to Z).
  - It needs no index: it runs over one user's rows (at most 50,000), after the `user_id` and
    `group_id` conditions.

## Frontend

### The URL and the data

- **URL:** `ListingParams` gains `q`, kept in the URL as `?q=`. Like the other settings, it
  survives a reload and is left out when empty. It's trimmed and its runs of whitespace become
  one space. Read from a (hand-edited) URL, it's cut to `MaxSearchLength` and loses any NUL, so
  the server never refuses it.
- **Requests and keys:** `q` goes to the endpoints (left out when empty) and into the
  `listingGroups` and `listingEntries` query keys. The changes that refresh listings refresh
  every search's listing, because they refresh by key prefix.
- **No blinking while typing:** when only the search has changed, the last search's results
  stay up, marked `aria-busy` and dimmed, until the new ones arrive (as the card search's results
  do). This happens in two steps:
  1. the last search's groups and sections stay until the new groups arrive;
  2. then each open section keeps the last search's cards until its own new cards arrive, and
     keeps the heading those cards came with.

  A change of grouping, order or listing still shows the loading state.
- **Matching groups and sections:** the groups' data records which search it's for. Sections
  fetch their entries for that search, and a section's heading is always that of the cards
  under it. A closed section shows the current search's heading.
- **Sections a search leaves:** a new search opens any section that a fresh page would open
  (all of them when it leaves 8 groups or fewer). It never closes one that's open.
- **Searching from far down the page:** when the new results arrive and their start is behind
  the sticky toolbar, the start is scrolled into view, instead of leaving the page in the middle
  of the results or past their end.

### The toolbar

`ListingControls` holds Group by, Sort by and View today. It has no filter toggles, so the box
goes **after Sort by and before View**: a "Search" field with the existing `SearchInput`
primitive (`src/ui/Field.tsx`).
- **Behaviour:** `SearchInput` reports after a 300 ms pause or on Enter, and has a clear (×)
  button and Escape-to-clear.
- **Text:** the placeholder reads "Name or type". The box holds at most `MaxSearchLength`
  characters.
- **When the URL changes elsewhere:** say the nav link to the collection is clicked while on
  `?q=goblin`. The box starts afresh from the new URL. Its own writes don't make it start afresh
  (`SearchPage`'s "own write" approach).
- **Wide screens:** the field grows to fill the space between Sort by and View, up to a sensible
  maximum. View keeps its place at the right.
- **Phone width:** labels go above, as for the other fields there. The field shares the second
  row with View, which keeps the sticky toolbar short. (A row of its own was the first idea; the
  shared row looked better and saves about 50 px of sticky bar.) The sticky toolbar's height is
  already measured (`useToolbarHeight`), so the section headings still stick below it.
- **Themes:** it uses the existing tokens and `.search-input` styles, so both themes are covered.
  It is checked in both at desktop and phone width.

### Results and the empty state

- **No matches:** the page shows "No cards match “goblin”", with "Check the spelling, or clear
  the search." This replaces "Your collection is empty". The clear button is already in the box,
  next to the text the user typed. A long word wraps rather than widening the page.
- **No cards at all:** an empty collection or group keeps its usual "add cards" empty state,
  searching or not.
- **Screen readers:** a visually hidden status (`role="status"`) says "12 cards match" or "No
  cards match" once a search's groups arrive. That way a screen reader user hears the result of
  typing (WCAG 4.1.3).
- **Unchanged:** the collection's totals at the top stay for the whole collection.

### Custom groups' pages (the user's decision: both pages)

The group page uses the same `ListingControls`, `Listing` and listing API, so it gets the search
too, with its own empty state ("No cards in Trade binder match “goblin”"). The shared toolbar has
no "search or not" switch, and no URL parameter is honoured by only one page.

## Tests

### Backend

- **Unit:**
  - turning `q` into patterns: words, escaping, empty;
  - the length and NUL refusals;
  - a cursor for one search refused with another;
  - cursors without a search still accepted.
- **Integration (real Postgres):**
  - matching by a name word and by a type-line word;
  - words in any order, split across name and type line;
  - case;
  - literal `%` and `_`;
  - each of the four orders paging through more than one page of matches only;
  - group totals over matches only;
  - groups without a match left out;
  - `none`'s group zeroed when nothing matches;
  - a custom group's listing narrowed;
  - another user's cards never matching.
- **API:** `q` passed on by all four handlers.

### Frontend

- **Unit:** `readListing`/`writeListing` with `q` (default left out, normalised); the query keys.
- **Behaviour (whole app, fake API):**
  - the box is between Sort by and View;
  - typing narrows (the requests carry `q`, and only the matches show);
  - the empty-results state;
  - "Show more" sends `q` with the cursor;
  - the search works with Group by;
  - the status message;
  - the box restarting when the URL changes elsewhere;
  - the last results staying up while the next search loads;
  - the group page's search and empty state.
- **Gallery:** `ListingControls` with the search.

### Visual

Both themes, at desktop and phone width, in the browser.

## Other work in flight

PR #22 (prices in pounds) is open. It touches `CollectionPage.tsx`, its tests, `queries.ts`,
`keys.ts`, `endpoints.ts`, `index.css` and the test helpers. This branch starts from `develop`
and is rebased onto it once #22 merges. Neither changes the other's behaviour, so any conflicts
are in neighbouring lines only.
