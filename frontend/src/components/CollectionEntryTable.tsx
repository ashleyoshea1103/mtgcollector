import type { ReactNode } from 'react';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from '../lib/labels';
import type { CollectionEntry } from '../types';
import { ManaCost } from './ManaCost';
import { Price } from './Price';
import { SetSymbol } from './SetSymbol';

interface RowProps {
  entry: CollectionEntry;
  actions?: ReactNode;
}

/** An owned card in list view. */
export function CollectionEntryRow({ entry, actions }: RowProps) {
  const { card } = entry;
  return (
    <tr className={`entry-row entry-row--${entry.finish}`}>
      <td className="entry-row__quantity">{entry.quantity}</td>
      <th scope="row" className="entry-row__name">
        {card.name}
      </th>
      <td className="entry-row__cost">
        <ManaCost cost={card.mana_cost} />
      </td>
      <td className="entry-row__type">{card.type_line}</td>
      <td className="entry-row__set">
        <SetSymbol set={card.set} rarity={card.rarity} nameShown /> {card.set.name} #{card.collector_number}
      </td>
      <td className="entry-row__condition">
        <abbr title={labelFor(CONDITIONS, entry.condition)}>{entry.condition}</abbr>
      </td>
      <td className="entry-row__finish">{labelFor(FINISHES, entry.finish)}</td>
      <td className="entry-row__language">{labelFor(LANGUAGES, entry.language)}</td>
      <td className="entry-row__price">
        <Price value={entry.unit_price_eur} />
      </td>
      <td className="entry-row__value">
        <Price value={entry.value_eur} />
      </td>
      {actions !== undefined && <td className="entry-row__actions">{actions}</td>}
    </tr>
  );
}

interface TableProps {
  entries: CollectionEntry[];
  renderActions?: (entry: CollectionEntry) => ReactNode;
}

/** Owned cards as a table, one row per entry. */
export function CollectionEntryTable({ entries, renderActions }: TableProps) {
  return (
    <table className="entry-table">
      <thead>
        <tr>
          <th scope="col">Qty</th>
          <th scope="col">Name</th>
          <th scope="col">Cost</th>
          <th scope="col">Type</th>
          <th scope="col">Set</th>
          <th scope="col">Condition</th>
          <th scope="col">Finish</th>
          <th scope="col">Language</th>
          <th scope="col">Price</th>
          <th scope="col">Value</th>
          {renderActions && <th scope="col" aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <CollectionEntryRow
            key={entry.id}
            entry={entry}
            // null (not undefined) keeps the actions cell so columns stay aligned with the header
            actions={renderActions ? (renderActions(entry) ?? null) : undefined}
          />
        ))}
      </tbody>
    </table>
  );
}
