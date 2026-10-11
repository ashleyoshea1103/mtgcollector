import { useMemo, useState, type ReactNode } from 'react';
import type { ListingId } from '../api/keys';
import { useListingEntries, useListingGroups, type ListedEntry } from '../api/queries';
import { GroupBucketSection } from '../components/GroupBucketSection';
import type { ListingParams } from '../lib/listingParams';
import { errorMessage } from '../lib/messages';
import type { GroupSummary } from '../types';
import { ErrorBoundary, ErrorState, Loading, toast } from '../ui';

interface Props {
  /** The whole collection (null) or a custom group's id. */
  listing: ListingId;
  params: ListingParams;
  /** Buttons for each entry, e.g. a menu of actions. */
  renderActions?: (row: ListedEntry) => ReactNode;
  /** Shown when there are no cards to list. */
  empty: ReactNode;
}

/** Up to this many groups all start open; with more (e.g. by set), only the first does, so a page doesn't fetch dozens at once. */
const OPEN_ALL_UP_TO = 8;

/** A listing's cards in sections by the chosen grouping, each fetching its entries a page at a time while open. */
export function Listing({ listing, params, renderActions, empty }: Props) {
  const groups = useListingGroups(listing, params.groupBy);
  if (groups.isPending) return <Loading />;
  if (groups.isError) return <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />;
  const list = groups.data.groups;
  if (list.every((g) => g.card_count === 0)) return <>{empty}</>;
  return (
    <div className="listing">
      {list.map((group, i) => (
        // One section that can't be shown (a bad record) doesn't take the others with it.
        <ErrorBoundary
          key={`${params.groupBy}:${group.key}`}
          resetKeys={[group]}
          fallback={(reset) => <ErrorState className="listing__error" message={`Couldn't show ${group.label}.`} onRetry={reset} />}
        >
          <Section listing={listing} group={group} params={params} defaultOpen={list.length <= OPEN_ALL_UP_TO || i === 0} renderActions={renderActions} />
        </ErrorBoundary>
      ))}
    </div>
  );
}

interface SectionProps {
  listing: ListingId;
  group: GroupSummary;
  params: ListingParams;
  defaultOpen: boolean;
  renderActions?: (row: ListedEntry) => ReactNode;
}

function Section({ listing, group, params, defaultOpen, renderActions }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = useListingEntries(listing, params.groupBy, group.key, params.sort, open);
  const rows = entries.data;
  const byId = useMemo(() => new Map(rows?.map((r) => [r.entry.id, r])), [rows]);

  async function loadMore() {
    const result = await entries.fetchNextPage();
    if (result.isFetchNextPageError) toast({ title: `Couldn't load more of ${group.label}`, description: errorMessage(result.error), tone: 'error' });
  }

  return (
    <GroupBucketSection
      group={group}
      entries={rows?.map((r) => r.entry)}
      view={params.view}
      open={open}
      onOpenChange={setOpen}
      // Opening fetches by itself (the query is enabled while open); this is the retry.
      onLoad={() => {
        if (entries.isError) void entries.refetch();
      }}
      onLoadMore={entries.hasNextPage ? () => void loadMore() : undefined}
      loadingMore={entries.isFetchingNextPage}
      loadFailed={entries.isError && rows === undefined}
      renderActions={
        renderActions &&
        ((entry) => {
          const row = byId.get(entry.id);
          return row ? renderActions(row) : null;
        })
      }
    />
  );
}
