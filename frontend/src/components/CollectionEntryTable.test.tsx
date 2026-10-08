import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { entries, serverPricedBolts } from '../fixtures';
import { CONDITIONS, FINISHES, LANGUAGES } from '../lib/labels';
import { cellsByColumn, eur, getByTooltip } from '../test/helpers';
import { CollectionEntryTable } from './CollectionEntryTable';

const all = Object.values(entries);
const rowFor = (name: string) => screen.getByRole('rowheader', { name }).closest('tr')!;

describe('CollectionEntryTable', () => {
  it('shows one row per entry, named by card', () => {
    render(<CollectionEntryTable entries={all} />);
    expect(screen.getAllByRole('row')).toHaveLength(all.length + 1); // + header
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual(all.map((e) => e.card.name));
  });

  it.each(all.map((e) => [e.card.name, e] as const))('shows every detail of %s in its own column', (name, entry) => {
    render(<CollectionEntryTable entries={all} />);
    const cells = cellsByColumn(rowFor(name));
    expect(cells.Qty).toHaveTextContent(new RegExp(`^${entry.quantity}$`));
    expect(cells.Type).toHaveTextContent(entry.card.type_line);
    expect(cells.Set).toHaveTextContent(`${entry.card.set.name} #${entry.card.collector_number}`);
    expect(cells.Set).not.toHaveTextContent(entry.card.set.code.toUpperCase()); // the symbol stands in for the code
    expect(cells.Set.querySelector('.set-symbol img')).toHaveAttribute('src', entry.card.set.icon_svg_uri);
    expect(getByTooltip(cells.Condition, CONDITIONS[entry.condition])).toHaveTextContent(entry.condition);
    expect(cells.Finish).toHaveTextContent(new RegExp(`^${FINISHES[entry.finish]}$`));
    expect(cells.Language).toHaveTextContent(new RegExp(`^${LANGUAGES[entry.language]}$`));
    expect(cells.Price).toHaveTextContent(eur(entry.unit_price_eur));
    expect(cells.Value).toHaveTextContent(eur(entry.value_eur));
  });

  it("shows the server's unit price, not one worked out from the card", () => {
    render(<CollectionEntryTable entries={[serverPricedBolts]} />);
    const cells = cellsByColumn(rowFor(serverPricedBolts.card.name));
    expect(cells.Price).toHaveTextContent(eur(serverPricedBolts.unit_price_eur));
    expect(cells.Value).toHaveTextContent(eur(serverPricedBolts.value_eur));
  });

  it('shows the unit price and the line value separately', () => {
    render(<CollectionEntryTable entries={[entries.bolts]} />);
    const cells = cellsByColumn(rowFor(entries.bolts.card.name));
    expect(entries.bolts.quantity).toBeGreaterThan(1);
    expect(cells.Price).toHaveTextContent(eur(entries.bolts.unit_price_eur));
    expect(cells.Value).toHaveTextContent(eur(entries.bolts.value_eur));
  });

  it('shows unknown or hostile codes from the server as-is instead of crashing', () => {
    const odd = { ...entries.bolts, language: '__proto__', condition: 'constructor' as never };
    render(<CollectionEntryTable entries={[odd]} />);
    const cells = cellsByColumn(rowFor(odd.card.name));
    expect(cells.Language).toHaveTextContent('__proto__');
    expect(getByTooltip(cells.Condition, 'constructor')).toBeInTheDocument();
  });

  it('has no actions column unless actions are provided', () => {
    render(<CollectionEntryTable entries={all} />);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    for (const row of screen.getAllByRole('row')) expect(row.children).toHaveLength(10);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('keeps rows aligned with the header when some rows return %s for actions', (_, empty) => {
    render(
      <CollectionEntryTable
        entries={all}
        renderActions={(e) => (e.value_eur == null ? empty : <button type="button">Remove</button>)}
      />,
    );
    const [header, ...rows] = screen.getAllByRole('row');
    const columns = within(header).getAllByRole('columnheader').length;
    for (const row of rows) expect(row.children).toHaveLength(columns);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(all.filter((e) => e.value_eur != null).length);
  });
});
