import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cellsByColumn } from '../test/helpers';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: number;
  name: string;
  qty: number;
}
const rows: Row[] = [
  { id: 1, name: 'Bolt', qty: 4 },
  { id: 2, name: 'Elves', qty: 1 },
];
const columns: Column<Row>[] = [
  { key: 'qty', header: 'Qty', cell: (r) => r.qty, className: 'qty' },
  { key: 'name', header: 'Name', cell: (r) => r.name, rowHeader: true },
  { key: 'actions', header: 'Actions', hideHeader: true, cell: (r) => (r.qty > 1 ? <button type="button">Split</button> : null) },
];

describe('DataTable', () => {
  it('is a table with column headers and rows named by their row header', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} aria-label="Cards" />);
    const table = screen.getByRole('table', { name: 'Cards' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Qty', 'Name', 'Actions']);
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Bolt', 'Elves']);
    expect(cellsByColumn(screen.getByRole('rowheader', { name: 'Bolt' }).closest('tr')!).Qty).toHaveTextContent('4');
  });

  it('keeps a hidden header for screen readers', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('columnheader', { name: 'Actions' }).firstElementChild).toHaveClass('visually-hidden');
  });

  it('gives every row a cell for every column, even an empty one', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    for (const row of screen.getAllByRole('row')) expect(row.children).toHaveLength(columns.length);
    expect(screen.getAllByRole('button', { name: 'Split' })).toHaveLength(1);
  });

  it('classes cells by column and rows as asked, and shows a caption', () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} rowClassName={(r) => `row-${r.id}`} caption="Owned" />);
    expect(screen.getByRole('table', { name: 'Owned' })).toBeInTheDocument();
    const bolt = screen.getByRole('rowheader', { name: 'Bolt' }).closest('tr')!;
    expect(bolt).toHaveClass('row-1');
    expect(bolt.querySelector('td')).toHaveClass('qty');
  });
});
