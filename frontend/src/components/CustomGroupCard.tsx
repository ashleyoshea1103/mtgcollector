import type { ReactNode } from 'react';
import { countOf } from '../lib/format';
import { GROUP_KINDS, labelFor } from '../lib/labels';
import type { CustomGroup } from '../types';
import { Cluster, EmptyState } from '../ui';
import { TotalValue } from './TotalValue';

interface Props {
  group: CustomGroup;
  actions?: ReactNode;
}

/** A user-created binder, deck or box, with a strip of up to four card images. */
export function CustomGroupCard({ group, actions }: Props) {
  const previews = group.preview_images.slice(0, 4);

  return (
    <article className={`custom-group-card custom-group-card--${group.kind}`}>
      <div className="custom-group-card__previews">
        {previews.length > 0 ? (
          previews.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)
        ) : (
          <EmptyState className="custom-group-card__empty" title="No cards yet" />
        )}
      </div>
      <h3 className="custom-group-card__name">{group.name}</h3>
      <Cluster as="p" className="custom-group-card__meta">
        <span className="custom-group-card__kind">{labelFor(GROUP_KINDS, group.kind)}</span>
        <span className="custom-group-card__count">
          {countOf(group.card_count, 'card')}
        </span>
        <TotalValue total={group} />
      </Cluster>
      {group.description && <p className="custom-group-card__description">{group.description}</p>}
      {actions && (
        <Cluster as="footer" className="custom-group-card__actions">
          {actions}
        </Cluster>
      )}
    </article>
  );
}
