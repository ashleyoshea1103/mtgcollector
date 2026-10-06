import { useState, type ReactNode } from 'react';
import { countOf } from '../lib/format';
import type { CollectionEntry, GroupSummary } from '../types';
import { CollectionEntryTable } from './CollectionEntryTable';
import { CollectionEntryTile } from './CollectionEntryTile';
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
  /** Called when the user opens or closes the section, e.g. to fetch its first page. */
  onOpenChange?: (open: boolean) => void;
  /** Called by the "Show more" button; shown only when set. */
  onLoadMore?: () => void;
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
  onLoadMore,
  renderActions,
}: Props) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isOpen = open ?? ownOpen;
  const toggle = () => {
    if (open === undefined) setOwnOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };

  return (
    <section className={`group-bucket group-bucket--${view}${isOpen ? ' group-bucket--open' : ''}`}>
      <h2 className="group-bucket__header">
        <button type="button" className="group-bucket__toggle" aria-expanded={isOpen} onClick={toggle}>
          <span className="group-bucket__label">{group.label}</span>{' '}
          <span className="group-bucket__count">{countOf(group.card_count, 'card')}</span>{' '}
          <span className="group-bucket__value">
            <TotalValue total={group} />
          </span>
        </button>
      </h2>

      {isOpen && (
        <div className="group-bucket__body">
          {entries === undefined ? (
            <p className="group-bucket__loading">Loading…</p>
          ) : view === 'grid' ? (
            <div className="entry-grid">
              {entries.map((entry) => (
                <CollectionEntryTile key={entry.id} entry={entry} actions={renderActions?.(entry)} />
              ))}
            </div>
          ) : (
            <CollectionEntryTable entries={entries} renderActions={renderActions} />
          )}
          {onLoadMore && (
            <button type="button" className="group-bucket__more" onClick={onLoadMore}>
              Show more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
