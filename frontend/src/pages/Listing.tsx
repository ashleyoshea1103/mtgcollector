import { useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { keys, type ListingId } from '../api/keys';
import { useListingEntries, useListingGroups, type ListedEntry, type ListingGroups } from '../api/queries';
import { GroupBucketSection } from '../components/GroupBucketSection';
import { countOf } from '../lib/format';
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
  /** Shown when there are no cards to list (none match, when searching). */
  empty: ReactNode;
}

/** Up to this many groups all start open; with more (e.g. by set), only the first does, so a page doesn't fetch dozens at once. */
const OPEN_ALL_UP_TO = 8;

const firstToggle = (part: HTMLElement) => part.querySelector<HTMLElement>('.group-bucket__toggle');

/** A listing's cards in sections by the chosen grouping, each fetching its entries a page at a time while open. */
export function Listing(props: Props) {
  // A card shown larger stays while the listing behind it reloads or empties (from another
  // tab, say), rather than going with it and coming back by itself.
  const viewer = useCardViewer();
  return (
    <>
      <Groups {...props} onViewCard={viewer.view} />
      {viewer.dialog}
    </>
  );
}

function Groups(props: Props & { onViewCard: (card: CardSummary) => void }) {
  const groups = useListingGroups(props.listing, props.params.groupBy, props.params.q);
  const start = useRef<HTMLParagraphElement>(null);
  useResultsInView(start, groups.data && !groups.isPlaceholderData ? groups.data.q : undefined);
  return (
    <>
      {/* First in every state, so the live region is there before what it says changes. It also
          marks where the results start. */}
      <p ref={start} role="status" className="visually-hidden listing__status">
        {groups.data && !groups.isPlaceholderData ? searchStatus(groups.data) : ''}
      </p>
      <GroupList {...props} groups={groups} />
    </>
  );
}

/**
 * When a new search's results arrive while their start is scrolled up behind the sticky toolbar
 * (searched from far down the page), brings the start into view: otherwise the page would open
 * in the middle of the results, or past their end. Not on the first results, so a reload keeps
 * its scroll position.
 */
function useResultsInView(start: RefObject<HTMLElement | null>, q: string | undefined) {
  const last = useRef(q);
  useLayoutEffect(() => {
    if (q === undefined) return;
    const before = last.current;
    last.current = q;
    if (before === undefined || before === q || !start.current) return;
    const toolbar = document.querySelector('.listing-controls')?.getBoundingClientRect().bottom ?? 0;
    // The html element's scroll-padding keeps it below the toolbar.
    if (start.current.getBoundingClientRect().top < toolbar) start.current.scrollIntoView({ block: 'start' });
  }, [start, q]);
}

/** What a search found, for a screen reader: nothing to say when not searching. */
function searchStatus({ q, groups }: ListingGroups) {
  if (q === '') return '';
  const cards = groups.reduce((n, g) => n + g.card_count, 0);
  return cards === 0 ? 'No cards match' : `${countOf(cards, 'card')} ${cards === 1 ? 'matches' : 'match'}`;
}

function GroupList({ listing, params, renderActions, empty, onViewCard, groups }: Props & { onViewCard: (card: CardSummary) => void; groups: ReturnType<typeof useListingGroups> }) {
  const client = useQueryClient();
  // A section that goes (its last card removed) takes focus with it: to the first section, then.
  const keepFocus = useFocusFallback<HTMLDivElement>(firstToggle, groups.data);
  // A refresh that fails keeps what's shown; only a first load that fails shows the error.
  if (groups.data === undefined) {
    return groups.isError ? <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} /> : <Loading />;
  }
  // The search these groups are for: while the next search's load, the last one's stand in, and
  // their sections stay with them.
  const { groups: list, q } = groups.data;
  // Not the last search's "nothing matches" while the next one's results load.
  if (list.every((g) => g.card_count === 0)) return groups.isPlaceholderData ? <Loading /> : <>{empty}</>;
  return (
    <div className="listing" aria-busy={groups.isPlaceholderData || undefined} {...keepFocus}>
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
            q={q}
            defaultOpen={list.length <= OPEN_ALL_UP_TO || i === 0}
            renderActions={renderActions}
            onViewCard={onViewCard}
          />
        </ErrorBoundary>
      ))}
    </div>
  );
}

interface SectionProps {
  listing: ListingId;
  group: GroupSummary;
  params: ListingParams;
  /** The search its group is from (not always params.q: see GroupList). */
  q: string;
  defaultOpen: boolean;
  renderActions?: (row: ListedEntry) => ReactNode;
  onViewCard: (card: CardSummary) => void;
}

function Section({ listing, group, params, q, defaultOpen, renderActions, onViewCard }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  // A new search opens the section if a fresh page would (a search that leaves few groups opens
  // them all), but never closes one that's open.
  const [openedFor, setOpenedFor] = useState(q);
  if (openedFor !== q) {
    setOpenedFor(q);
    if (defaultOpen) setOpen(true);
  }
  const entries = useListingEntries(listing, params.groupBy, group.key, params.sort, q, open);
  const rows = entries.data;
  const byId = useMemo(() => new Map(rows?.map((r) => [r.entry.id, r])), [rows]);
  // A card removed (with the Actions button that had focus) leaves focus on the section's heading.
  const keepFocus = useFocusFallback<HTMLDivElement>(firstToggle, rows);
  // While the last search's cards stand in for the next one's, the heading they came with stays
  // too, so the count and value are always those of the cards shown. (A closed section shows no
  // cards, so it has the current heading; its stand-in, if it had cards, waits for it to open.)
  const standIn = open && entries.isPlaceholderData;
  const [cardsHeading, setCardsHeading] = useState(group);
  if (rows !== undefined && !entries.isPlaceholderData && cardsHeading !== group) setCardsHeading(group);
  const heading = standIn ? cardsHeading : group;

  async function loadMore() {
    // Not cancelling a refresh under way (after a change), which would leave the old pages up.
    const result = await entries.fetchNextPage({ cancelRefetch: false });
    if (result.isFetchNextPageError) toast({ title: `Couldn't load more of ${group.label}`, description: errorMessage(result.error), tone: 'error' });
  }

  return (
    <div className="listing__section" aria-busy={standIn || undefined} {...keepFocus}>
      <GroupBucketSection
        group={heading}
        entries={rows?.map((r) => r.entry)}
        view={params.view}
        open={open}
        onOpenChange={setOpen}
        // Opening fetches by itself: the query is enabled while the section is open.
        onRetry={() => void entries.refetch()}
        // Not for the cards standing in: their next page is the last search's.
        onLoadMore={entries.hasNextPage && !standIn ? () => void loadMore() : undefined}
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
