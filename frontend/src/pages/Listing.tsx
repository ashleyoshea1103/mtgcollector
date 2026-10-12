import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { keys, type ListingId } from '../api/keys';
import { useListingEntries, useListingGroups, type ListedEntry } from '../api/queries';
import { GroupBucketSection } from '../components/GroupBucketSection';
import type { ListingParams } from '../lib/listingParams';
import { errorMessage } from '../lib/messages';
import type { CardSummary, GroupSummary } from '../types';
import { ErrorBoundary, ErrorState, Loading, toast, useFocusFallback } from '../ui';
import { useCardViewer } from './useCardViewer';

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

const firstToggle = (part: HTMLElement) => part.querySelector<HTMLElement>('.group-bucket__toggle');

/** A listing's cards in sections by the chosen grouping, each fetching its entries a page at a time while open. */
export function Listing({ listing, params, renderActions, empty }: Props) {
  const groups = useListingGroups(listing, params.groupBy);
  const client = useQueryClient();
  // A section that goes (its last card removed) takes focus with it: to the first section, then.
  const keepFocus = useFocusFallback<HTMLDivElement>(firstToggle, groups.data);
  const cards = useCardViewer();
  // A refresh that fails keeps what's shown; only a first load that fails shows the error.
  if (groups.data === undefined) {
    return groups.isError ? <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} /> : <Loading />;
  }
  const list = groups.data.groups;
  if (list.every((g) => g.card_count === 0)) return <>{empty}</>;
  return (
    <div className="listing" {...keepFocus}>
      {list.map((group, i) => (
        // One section that can't be shown (a bad record) doesn't take the others with it.
        <ErrorBoundary
          key={`${params.groupBy}:${group.key}`}
          resetKeys={[group]}
          fallback={(reset) => (
            <ErrorState
              className="listing__error"
              message={`Couldn't show ${group.label}.`}
              onRetry={() => {
                // The cards it couldn't show are fetched afresh, rather than shown again.
                void client.resetQueries({ queryKey: [...keys.listing(listing), 'entries', params.groupBy, group.key] });
                reset();
              }}
            />
          )}
        >
          <Section
            listing={listing}
            group={group}
            params={params}
            defaultOpen={list.length <= OPEN_ALL_UP_TO || i === 0}
            renderActions={renderActions}
            onViewCard={cards.view}
          />
        </ErrorBoundary>
      ))}
      {cards.viewer}
    </div>
  );
}

interface SectionProps {
  listing: ListingId;
  group: GroupSummary;
  params: ListingParams;
  defaultOpen: boolean;
  renderActions?: (row: ListedEntry) => ReactNode;
  onViewCard: (card: CardSummary) => void;
}

function Section({ listing, group, params, defaultOpen, renderActions, onViewCard }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = useListingEntries(listing, params.groupBy, group.key, params.sort, open);
  const rows = entries.data;
  const byId = useMemo(() => new Map(rows?.map((r) => [r.entry.id, r])), [rows]);
  // A card removed (with the Actions button that had focus) leaves focus on the section's heading.
  const keepFocus = useFocusFallback<HTMLDivElement>(firstToggle, rows);

  async function loadMore() {
    // Not cancelling a refresh under way (after a change), which would leave the old pages up.
    const result = await entries.fetchNextPage({ cancelRefetch: false });
    if (result.isFetchNextPageError) toast({ title: `Couldn't load more of ${group.label}`, description: errorMessage(result.error), tone: 'error' });
  }

  return (
    <div className="listing__section" {...keepFocus}>
      <GroupBucketSection
        group={group}
        entries={rows?.map((r) => r.entry)}
        view={params.view}
        open={open}
        onOpenChange={setOpen}
        // Opening fetches by itself: the query is enabled while the section is open.
        onRetry={() => void entries.refetch()}
        onLoadMore={entries.hasNextPage ? () => void loadMore() : undefined}
        // Busy while a refresh runs too: the next page follows the refreshed ones.
        loadingMore={entries.isFetching}
        loadFailed={entries.isError && rows === undefined}
        onViewCard={onViewCard}
        renderActions={
          renderActions &&
          ((entry) => {
            const row = byId.get(entry.id);
            return row ? renderActions(row) : null;
          })
        }
      />
    </div>
  );
}
