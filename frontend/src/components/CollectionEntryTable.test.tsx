import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { entries } from '../fixtures';
import { CollectionEntryTable } from './CollectionEntryTable';

const all = Object.values(entries);

describe('CollectionEntryTable', () => {
  it('shows one row per entry, named by card', () => {
    render(<CollectionEntryTable entries={all} />);
    expect(screen.getAllByRole('row')).toHaveLength(all.length + 1); // + header
    expect(screen.getByRole('rowheader', { name: 'Ragavan, Nimble Pilferer' })).toBeInTheDocument();
  });

  it('shows the finish, language and foil price for each copy', () => {
    render(<CollectionEntryTable entries={all} />);
    const ragavan = screen.getByRole('rowheader', { name: 'Ragavan, Nimble Pilferer' }).closest('tr')!;
    expect(ragavan).toHaveTextContent('Foil');
    expect(ragavan).toHaveTextContent(/53[.,]92/);
    const delver = screen.getByRole('rowheader', { name: /Delver of Secrets/ }).closest('tr')!;
    expect(delver).toHaveTextContent('German');
  });

  it('has no actions column unless actions are provided', () => {
    render(<CollectionEntryTable entries={all} />);
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('keeps every row aligned with the header when some rows have no actions', () => {
    render(
      <CollectionEntryTable
        entries={all}
        renderActions={(e) => (e.card.prices.eur == null ? null : <button type="button">Remove</button>)}
      />,
    );
    const [header, ...rows] = screen.getAllByRole('row');
    const columns = within(header).getAllByRole('columnheader').length;
    for (const row of rows) {
      expect(row.querySelectorAll('th, td')).toHaveLength(columns);
    }
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(all.length - 1);
  });
});
