import type { ReactNode } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import type { CollectionEntry } from '../types';
import { Badge, Cluster, TooltipText } from '../ui';
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
      overlay={<Badge className="entry-tile__quantity">{entry.quantity}×</Badge>}
      actions={actions}
    >
      <Cluster as="p" className="entry-tile__copy">
        <TooltipText as="abbr" className="entry-tile__condition" tooltip={labelFor(CONDITIONS, entry.condition)}>
          {entry.condition}
        </TooltipText>
        {entry.finish !== 'nonfoil' && <Badge className="entry-tile__finish">{labelFor(FINISHES, entry.finish)}</Badge>}
        {entry.language !== 'en' && (
          <TooltipText as="abbr" className="entry-tile__language" tooltip={labelFor(LANGUAGES, entry.language)}>
            {entry.language.toUpperCase()}
          </TooltipText>
        )}
      </Cluster>
      <p className="entry-tile__value">
        Value <Price value={entry.value_eur} />
      </p>
    </CardTile>
  );
}
