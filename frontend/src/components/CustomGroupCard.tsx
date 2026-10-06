import type { ReactNode } from 'react';
import { countOf } from '../lib/format';
import { GROUP_KINDS } from '../lib/labels';
import type { CustomGroup } from '../types';
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
          <p className="custom-group-card__empty">No cards yet</p>
        )}
      </div>
      <h3 className="custom-group-card__name">{group.name}</h3>
      <p className="custom-group-card__meta">
        <span className="custom-group-card__kind">{GROUP_KINDS[group.kind]}</span>
        <span className="custom-group-card__count">
          {countOf(group.card_count, 'card')}
        </span>
        <TotalValue total={group} />
      </p>
      {group.description && <p className="custom-group-card__description">{group.description}</p>}
      {actions && <footer className="custom-group-card__actions">{actions}</footer>}
    </article>
  );
}
