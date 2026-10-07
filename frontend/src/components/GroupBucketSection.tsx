import { useEffect, useEffectEvent, type ReactNode } from 'react';
import { countOf } from '../lib/format';
import type { CollectionEntry, GroupSummary } from '../types';
import { Button, Disclosure, EmptyState, ErrorState, Grid, Loading, useDisclosureState } from '../ui';
import { CollectionEntryTable } from './CollectionEntryTable';
import { CollectionEntryTile } from './CollectionEntryTile';
import { SetSymbol } from './SetSymbol';
import { TotalValue } from './TotalValue';

export type CollectionView = 'grid' | 'list';

interface Props {
  group: GroupSummary;
  /** The entries loaded so far; undefined while the first page hasn't arrived. */
  entries?: CollectionEntry[];
  view?: CollectionView;
  /** Controlled open state. Leave undefined to let the section manage it, starting from defaultOpen. */
  open?: boolean;
  defaultOpen?: boolean;
  /** Called when the user opens or closes the section. */
  onOpenChange?: (open: boolean) => void;
  /** Called whenever the section is open but has no entries yet: fetch the first page here. */
  onLoad?: () => void;
  /** Called by the "Show more" button, which is shown only when this is set. */
  onLoadMore?: () => void;
  /** True while a further page is being fetched; "Show more" ignores presses meanwhile. */
  loadingMore?: boolean;
  /** True when fetching the first page failed; shows a message with a retry that calls onLoad. */
  loadFailed?: boolean;
  renderActions?: (entry: CollectionEntry) => ReactNode;
}

/**
 * One collapsible section of an auto-grouped collection (e.g. all the red cards).
 * Entries are only rendered while the section is open.
 */
export function GroupBucketSection({
  group,
  entries,
  view = 'grid',
  open,
  defaultOpen = true,
  onOpenChange,
  onLoad,
  onLoadMore,
  loadingMore = false,
  loadFailed = false,
  renderActions,
}: Props) {
  const [isOpen, setOpen] = useDisclosureState({ open, defaultOpen, onOpenChange });

  // Ask for entries when the section starts needing them (on mount if it starts open),
  // not again just because the parent passed a new callback.
  const needsEntries = isOpen && entries === undefined;
  const load = useEffectEvent(() => onLoad?.());
  useEffect(() => {
    if (needsEntries) load();
  }, [needsEntries]);

  return (
    <Disclosure
      className={`group-bucket group-bucket--${view}${isOpen ? ' group-bucket--open' : ''}`}
      headingClassName="group-bucket__header"
      triggerClassName="group-bucket__toggle"
      panelClassName="group-bucket__body"
      open={isOpen}
      onOpenChange={setOpen}
      title={
        <>
          {group.set && (
            <>
              <SetSymbol set={group.set} nameShown />{' '}
            </>
          )}
          <span className="group-bucket__label">{group.label}</span>{' '}
          <span className="group-bucket__count">{countOf(group.card_count, 'card')}</span>{' '}
          <span className="group-bucket__value">
            <TotalValue total={group} />
          </span>
        </>
      }
    >
      {entries === undefined && loadFailed ? (
        <ErrorState className="group-bucket__error" message="Couldn't load these cards." onRetry={() => onLoad?.()} />
      ) : entries === undefined ? (
        <Loading className="group-bucket__loading" live={false} />
      ) : entries.length === 0 ? (
        <EmptyState className="group-bucket__empty" title="No cards in this group" />
      ) : (
        <>
          {view === 'grid' ? (
            <Grid minItemWidth="180px" className="entry-grid">
              {entries.map((entry) => (
                <CollectionEntryTile key={entry.id} entry={entry} actions={renderActions?.(entry)} />
              ))}
            </Grid>
          ) : (
            <CollectionEntryTable entries={entries} renderActions={renderActions} />
          )}
          {onLoadMore && (
            <Button className="group-bucket__more" onPress={onLoadMore} busy={loadingMore}>
              {loadingMore ? 'Loading…' : 'Show more'}
            </Button>
          )}
        </>
      )}
    </Disclosure>
  );
}
