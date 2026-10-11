import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useCard, useCopies, useMe, usePrintings } from '../api/queries';
import { CardDetail } from '../components/CardDetail';
import { NoLongerListed } from '../components/NoLongerListed';
import { SetSymbol } from '../components/SetSymbol';
import { errorMessage, isNotFound } from '../lib/messages';
import { loginUrl } from '../lib/nextPath';
import { cardPath } from '../lib/paths';
import { Button, ErrorState, Loading, Stack } from '../ui';
import { AddCardDialog } from './AddCardDialog';
import { NotFoundPage } from './NotFoundPage';

/** One printing in full: images, rules text, prices, your copies of it, and its other printings. */
export function CardPage() {
  const id = useParams().id ?? '';
  const card = useCard(id);
  const me = useMe();
  const copies = useCopies(id, Boolean(me.data));
  const location = useLocation();
  const [adding, setAdding] = useState(false);

  if (card.isPending) return <Loading />;
  if (card.isError) {
    // A 400 is an id that isn't a Scryfall id at all: no such card either.
    if (isNotFound(card.error) || (card.error instanceof ApiError && card.error.status === 400)) {
      return <NotFoundPage thing="card" back={{ to: '/search', label: 'Search for cards' }} />;
    }
    return <ErrorState message={errorMessage(card.error)} onRetry={() => void card.refetch()} />;
  }

  return (
    <Stack as="section" className="card-page" gap={5}>
      <title>{`${card.data.name} · mtgcollector`}</title>
      {/* Copies only while someone is signed in: a disabled query still has what it last fetched. */}
      <CardDetail card={card.data} entries={me.data ? copies.data?.entries : undefined} headingLevel={1} />
      {copies.isError && <ErrorState message={`Couldn't load your copies. ${errorMessage(copies.error)}`} onRetry={() => void copies.refetch()} />}
      {me.data ? (
        <p>
          <Button variant="primary" onPress={() => setAdding(true)}>
            Add to collection
          </Button>
        </p>
      ) : (
        me.data === null && (
          <p>
            <Link to={loginUrl(location.pathname)}>Log in</Link> to add it to your collection.
          </p>
        )
      )}
      <OtherPrintings id={card.data.id} />
      {adding && <AddCardDialog card={card.data} onClose={() => setAdding(false)} />}
    </Stack>
  );
}

/** Every printing of the card, newest first, each a link to its own page. */
function OtherPrintings({ id }: { id: string }) {
  const printings = usePrintings(id);
  return (
    <section className="card-page__printings" aria-labelledby="printings-heading">
      <h2 id="printings-heading">Printings</h2>
      {printings.isPending ? (
        <Loading label="Loading printings…" live={false} />
      ) : printings.isError ? (
        <ErrorState message={errorMessage(printings.error)} onRetry={() => void printings.refetch()} />
      ) : (
        <ul className="printing-links">
          {printings.data.map((p) => (
            <li key={p.id}>
              {p.id === id ? (
                <span aria-current="page">
                  <SetSymbol set={p.set} rarity={p.rarity} nameShown /> {p.set.name} #{p.collector_number} (this one)
                </span>
              ) : (
                <Link to={cardPath(p.id)}>
                  <SetSymbol set={p.set} rarity={p.rarity} nameShown /> {p.set.name} #{p.collector_number}
                </Link>
              )}{' '}
              <time dateTime={p.released_at}>{p.released_at.slice(0, 4)}</time> <NoLongerListed card={p} />
            </li>
          ))}
        </ul>
      )}
      {printings.hasNextPage && (
        <Button onPress={() => void printings.fetchNextPage()} busy={printings.isFetchingNextPage}>
          {printings.isFetchingNextPage ? 'Loading…' : 'More printings'}
        </Button>
      )}
    </section>
  );
}
