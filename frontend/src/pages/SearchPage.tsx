import { useState } from 'react';
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router';
import { useCardSearch, useMe } from '../api/queries';
import { CardTile } from '../components/CardTile';
import { SearchFilters } from '../components/SearchFilters';
import { errorMessage } from '../lib/messages';
import { loginUrl } from '../lib/nextPath';
import { canSearch, readSearch, writeSearch } from '../lib/search';
import { MinSearchWord, type CardSummary } from '../types';
import { Button, EmptyState, ErrorState, Grid, Loading, Stack, VisuallyHidden } from '../ui';
import { AddCardDialog } from './AddCardDialog';

/** Searching every card by name and filters; signed-in users can add what they find. The search is kept in the URL. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const search = readSearch(params);
  const location = useLocation();
  const me = useMe();
  const ready = canSearch(search);
  const results = useCardSearch(search, ready);
  const [adding, setAdding] = useState<CardSummary | null>(null);

  // The text boxes keep what's typed. Going back or forward to another search starts them
  // afresh from the URL; the search's own changes (replacing the URL as you type) don't.
  const navigation = useNavigationType();
  const [formKey, setFormKey] = useState(location.key);
  if (navigation === 'POP' && formKey !== location.key) setFormKey(location.key);

  return (
    <Stack as="section" className="search-page" gap={5}>
      <title>Search · mtgcollector</title>
      <h1>Search cards</h1>
      <SearchFilters key={formKey} value={search} onChange={(next) => setParams(writeSearch(next), { replace: true })} />
      {me.data === null && (
        <p className="search-page__login">
          <Link to={loginUrl(location.pathname + location.search)}>Log in</Link> to add cards to your collection.
        </p>
      )}
      {!ready ? (
        <p className="search-page__hint">Type at least {MinSearchWord} letters of a card's name, or a set code.</p>
      ) : results.isPending ? (
        <Loading label="Searching…" />
      ) : results.isError ? (
        <ErrorState message={errorMessage(results.error)} onRetry={() => void results.refetch()} />
      ) : results.data.length === 0 ? (
        <EmptyState title="No cards match">Check the spelling, or take a filter off.</EmptyState>
      ) : (
        // Busy while the results of an older search stand in for the new one's.
        <div className="search-page__results" aria-busy={results.isPlaceholderData || undefined}>
          <Grid as="ul" minItemWidth="180px" className="card-grid">
            {results.data.map((card) => (
              <li key={card.id}>
                <CardTile
                  card={card}
                  actions={
                    <>
                      <Link to={`/cards/${encodeURIComponent(card.id)}`}>
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
            <Button className="search-page__more" onPress={() => void results.fetchNextPage()} busy={results.isFetchingNextPage}>
              {results.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </Button>
          )}
        </div>
      )}
      {adding && <AddCardDialog card={adding} pickPrinting onClose={() => setAdding(null)} />}
    </Stack>
  );
}
