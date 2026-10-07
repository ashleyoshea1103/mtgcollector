import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { countOf } from '../lib/format';
import type { CollectionEntry, GroupSummary } from '../types';
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
  /** True while a further page is being fetched; disables "Show more". */
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
  const [ownOpen, setOwnOpen] = useState(open ?? defaultOpen);
  // Track the controlled value so that if the parent stops controlling it,
  // the section stays where it was instead of jumping back to defaultOpen.
  if (open !== undefined && open !== ownOpen) setOwnOpen(open);
  const isOpen = open ?? ownOpen;

  const toggle = () => {
    if (open === undefined) setOwnOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };

  // Ask for entries when the section starts needing them (on mount if it starts open),
  // not again just because the parent passed a new callback.
  const needsEntries = isOpen && entries === undefined;
  const load = useEffectEvent(() => onLoad?.());
  useEffect(() => {
    if (needsEntries) load();
  }, [needsEntries]);

  return (
    <section className={`group-bucket group-bucket--${view}${isOpen ? ' group-bucket--open' : ''}`}>
      <h2 className="group-bucket__header">
        <button type="button" className="group-bucket__toggle" aria-expanded={isOpen} onClick={toggle}>
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
        </button>
      </h2>

      {isOpen && (
        <div className="group-bucket__body">
          {entries === undefined && loadFailed ? (
            <p className="group-bucket__error" role="alert">
              Couldn't load these cards.{' '}
              <button type="button" onClick={() => onLoad?.()}>
                Try again
              </button>
            </p>
          ) : entries === undefined ? (
            <p className="group-bucket__loading">Loading…</p>
          ) : (
            <>
              {view === 'grid' ? (
                <div className="entry-grid">
                  {entries.map((entry) => (
                    <CollectionEntryTile key={entry.id} entry={entry} actions={renderActions?.(entry)} />
                  ))}
                </div>
              ) : (
                <CollectionEntryTable entries={entries} renderActions={renderActions} />
              )}
              {onLoadMore && (
                <button type="button" className="group-bucket__more" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
