import { Link, useSearchParams } from 'react-router';
import { useStats } from '../api/queries';
import { CollectionSummary } from '../components/CollectionSummary';
import { ListingControls } from '../components/ListingControls';
import { readListing, writeListing } from '../lib/listingParams';
import { errorMessage } from '../lib/messages';
import { EmptyState, ErrorState, Loading, Stack } from '../ui';
import { EntryActions } from './EntryActions';
import { Listing } from './Listing';

/** The signed-in user's whole collection: totals, then the cards grouped and sorted as chosen. */
export function CollectionPage() {
  const [params, setParams] = useSearchParams();
  const listing = readListing(params);
  const stats = useStats();

  return (
    <Stack as="section" className="collection-page" gap={5}>
      <title>Your collection · mtgcollector</title>
      <h1>Your collection</h1>
      {stats.data === undefined ? (
        stats.isError ? (
          <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
        ) : (
          <Loading label="Loading totals…" live={false} />
        )
      ) : (
        <CollectionSummary stats={stats.data} />
      )}
      {/* The same page, so it stays where it's scrolled to. */}
      <ListingControls value={listing} onChange={(next) => setParams(writeListing(params, next), { replace: true, preventScrollReset: true })} />
      <Listing
        listing={null}
        params={listing}
        renderActions={(row) => <EntryActions entry={row.entry} />}
        empty={
          <EmptyState title="Your collection is empty" action={<Link to="/search">Search for cards to add</Link>}>
            Find a card, pick the printing you have, and add it.
          </EmptyState>
        }
      />
    </Stack>
  );
}
