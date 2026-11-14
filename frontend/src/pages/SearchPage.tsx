import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useCardSearch, useMe } from '../api/queries';
import { CardTile } from '../components/CardTile';
import { RateNote } from '../components/RateNote';
import { SearchFilters } from '../components/SearchFilters';
import { errorMessage } from '../lib/messages';
import { loginUrl } from '../lib/nextPath';
import { cardPath } from '../lib/paths';
import { canSearch, EMPTY_SEARCH, isSetCode, readSearch, writeSearch } from '../lib/search';
import { MinSearchWord, type CardSummary } from '../types';
import { Button, EmptyState, ErrorState, Grid, Loading, Stack, VisuallyHidden } from '../ui';
import { AddCardDialog } from './AddCardDialog';
import { useCardViewer } from './useCardViewer';

// Searches to try before typing one, each named by what it finds. The type-and-colour one names
// a set too, since the API needs a name or a set to search by.
const EXAMPLES = [
  { label: 'Lightning Bolt', search: { ...EMPTY_SEARCH, q: 'lightning bolt' } },
  { label: 'Modern Horizons 2 (mh2)', search: { ...EMPTY_SEARCH, set: 'mh2' } },
  { label: 'red dragons in Core Set 2019', search: { ...EMPTY_SEARCH, set: 'm19', type: 'dragon', colors: 'R' } },
];

/** Searching every card by name and filters; signed-in users can add what they find. The search is kept in the URL. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const search = readSearch(params);
  const location = useLocation();
  const me = useMe();
  const ready = canSearch(search);
  const results = useCardSearch(search, ready);
  const [adding, setAdding] = useState<CardSummary | null>(null);
  const viewer = useCardViewer();

  // The text boxes keep what's typed, and the page writes it to the URL. A URL the page didn't
  // write (going back or forward, or a link to another search) starts them afresh from it.
  // `own` is the page's last write: the URL changes a render after it's asked for, so it's
  // recognised when it arrives rather than assumed at once.
  const now = params.toString();
  const [form, setForm] = useState<{ key: string; search: string; own: string | null }>({ key: location.key, search: now, own: null });
  if (now !== form.search) setForm(now === form.own ? { ...form, search: now } : { key: location.key, search: now, own: null });
  const changeSearch = (next: typeof search) => {
    const written = writeSearch(next);
    setForm((f) => ({ ...f, own: written.toString() }));
    // The same page, so it stays where it's scrolled to.
    setParams(written, { replace: true, preventScrollReset: true });
  };

  return (
    <Stack as="section" className="search-page" gap={5}>
      <title>Search · mtgcollector</title>
      <h1>Search cards</h1>
      <SearchFilters key={form.key} value={search} onChange={changeSearch} />
      {(me.data === null || me.isError) && (
        <p className="search-page__login">
          <Link to={loginUrl(location.pathname + location.search)}>Log in</Link> to add cards to your collection.
        </p>
      )}
      {!ready ? (
        search.set !== '' && !isSetCode(search.set) ? (
          <p className="search-page__hint">Correct the set code to search.</p>
        ) : (
          <div className="search-page__hint">
            <p>Type at least {MinSearchWord} letters of a card's name, or a set code.</p>
            <p>
              Or try{' '}
              {EXAMPLES.map(({ label, search: example }, i) => (
                <span key={label}>
                  {i > 0 && (i === EXAMPLES.length - 1 ? ' or ' : ', ')}
                  {/* A link rather than a write, so it's a new search the form starts afresh from. */}
                  <Link to={`/search?${writeSearch(example)}`}>{label}</Link>
                </span>
              ))}
              .
            </p>
          </div>
        )
      ) : results.data === undefined ? (
        results.isError ? (
          <ErrorState message={errorMessage(results.error)} onRetry={() => void results.refetch()} />
        ) : (
          <Loading label="Searching…" />
        )
      ) : results.data.length === 0 ? (
        <EmptyState title="No cards match">Check the spelling, or take a filter off.</EmptyState>
      ) : (
        // Busy while the results of an older search stand in for the new one's.
        <div className="search-page__results" aria-busy={results.isPlaceholderData || undefined}>
          <h2 className="visually-hidden">Results</h2>
          <RateNote />
          <Grid as="ul" minItemWidth="180px" className="card-grid">
            {results.data.map((card) => (
              <li key={card.id}>
                <CardTile
                  card={card}
                  onView={() => viewer.view(card)}
                  actions={
                    <>
                      <Link to={cardPath(card.id)}>
                        Details <VisuallyHidden>of {card.name}</VisuallyHidden>
                      </Link>
                      {me.data && (
                        <Button onPress={() => setAdding(card)}>
                          Add <VisuallyHidden>{card.name}</VisuallyHidden>
                        </Button>
                      )}
                    </>
                  }
                />
              </li>
            ))}
          </Grid>
          {results.hasNextPage && (
            <Button className="search-page__more" onPress={() => void results.fetchNextPage({ cancelRefetch: false })} busy={results.isFetching}>
              {results.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          )}
        </div>
      )}
      {adding && <AddCardDialog card={adding} pickPrinting onClose={() => setAdding(null)} />}
      {viewer.dialog}
    </Stack>
  );
}
