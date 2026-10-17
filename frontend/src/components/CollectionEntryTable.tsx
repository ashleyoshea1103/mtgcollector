import type { ReactNode } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import type { CollectionEntry } from '../types';
import { DataTable, TooltipText, type Column } from '../ui';
import { ManaCost } from './ManaCost';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface Props {
  entries: CollectionEntry[];
  renderActions?: (entry: CollectionEntry) => ReactNode;
}

const COLUMNS: Column<CollectionEntry>[] = [
  { key: 'quantity', header: 'Qty', className: 'entry-row__quantity', cell: (e) => e.quantity },
  { key: 'name', header: 'Name', className: 'entry-row__name', rowHeader: true, cell: (e) => e.card.name },
  { key: 'cost', header: 'Cost', className: 'entry-row__cost', cell: (e) => <ManaCost cost={e.card.mana_cost} /> },
  { key: 'type', header: 'Type', className: 'entry-row__type', cell: (e) => e.card.type_line },
  {
    key: 'set',
    header: 'Set',
    className: 'entry-row__set',
    cell: ({ card }) => (
      <>
        <SetSymbol set={card.set} rarity={card.rarity} nameShown /> {card.set.name} #{card.collector_number}
      </>
    ),
  },
  {
    key: 'condition',
    header: 'Condition',
    className: 'entry-row__condition',
    cell: (e) => (
      <TooltipText as="abbr" tooltip={labelFor(CONDITIONS, e.condition)}>
        {e.condition}
      </TooltipText>
    ),
  },
  { key: 'finish', header: 'Finish', className: 'entry-row__finish', cell: (e) => labelFor(FINISHES, e.finish) },
  { key: 'language', header: 'Language', className: 'entry-row__language', cell: (e) => labelFor(LANGUAGES, e.language) },
  { key: 'price', header: 'Price', className: 'entry-row__price', cell: (e) => <Price value={e.unit_price_eur} /> },
  { key: 'value', header: 'Value', className: 'entry-row__value', cell: (e) => <Price value={e.value_eur} /> },
];

/** Owned cards as a table (the list view), one row per entry, named by the card. */
export function CollectionEntryTable({ entries, renderActions }: Props) {
  const columns = renderActions
    ? [...COLUMNS, { key: 'actions', header: 'Actions', hideHeader: true, className: 'entry-row__actions', cell: renderActions }]
    : COLUMNS;
  return (
    <DataTable
      className="entry-table"
      columns={columns}
      rows={entries}
      rowKey={(e) => e.id}
      rowClassName={(e) => `entry-row entry-row--${e.finish}`}
    />
  );
}
