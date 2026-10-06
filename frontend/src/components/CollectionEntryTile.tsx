import type { ReactNode } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import type { CollectionEntry } from '../types';
import { CardTile } from './CardTile';
import { Price } from './Price';

interface Props {
  entry: CollectionEntry;
  actions?: ReactNode;
}

/** An owned card in grid view: the card tile plus quantity, finish, condition and line value. */
export function CollectionEntryTile({ entry, actions }: Props) {
  return (
    <CardTile
      card={entry.card}
      finish={entry.finish}
      unitPrice={entry.unit_price_eur}
      className="entry-tile"
      overlay={<span className="entry-tile__quantity">{entry.quantity}×</span>}
      actions={actions}
    >
      <p className="entry-tile__copy">
        <abbr className="entry-tile__condition" title={labelFor(CONDITIONS, entry.condition)}>
          {entry.condition}
        </abbr>
        {entry.finish !== 'nonfoil' && <span className="entry-tile__finish">{labelFor(FINISHES, entry.finish)}</span>}
        {entry.language !== 'en' && (
          <abbr className="entry-tile__language" title={labelFor(LANGUAGES, entry.language)}>
            {entry.language.toUpperCase()}
          </abbr>
        )}
      </p>
      <p className="entry-tile__value">
        Value <Price value={entry.value_eur} />
      </p>
    </CardTile>
  );
}
