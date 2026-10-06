import type { ReactNode } from 'react';
import type { CollectionEntry, GroupBucket } from '../types';
import { CollectionEntryTable } from './CollectionEntryTable';
import { CollectionEntryTile } from './CollectionEntryTile';
import { Price } from './Price';

export type CollectionView = 'grid' | 'list';

interface Props {
  bucket: GroupBucket;
  view?: CollectionView;
  defaultOpen?: boolean;
  renderActions?: (entry: CollectionEntry) => ReactNode;
}

/** One collapsible section of an auto-grouped collection (e.g. all the red cards). */
export function GroupBucketSection({ bucket, view = 'grid', defaultOpen = true, renderActions }: Props) {
  return (
    <details className={`group-bucket group-bucket--${view}`} open={defaultOpen}>
      <summary className="group-bucket__header">
        <h2 className="group-bucket__label">{bucket.label}</h2>
        <span className="group-bucket__count">
          {bucket.card_count} {bucket.card_count === 1 ? 'card' : 'cards'}
        </span>
        <span className="group-bucket__value">
          <Price value={bucket.value_eur} />
        </span>
      </summary>

      {view === 'grid' ? (
        <div className="entry-grid">
          {bucket.entries.map((entry) => (
            <CollectionEntryTile key={entry.id} entry={entry} actions={renderActions?.(entry)} />
          ))}
        </div>
      ) : (
        <CollectionEntryTable entries={bucket.entries} renderActions={renderActions} />
      )}
    </details>
  );
}
