import type { Key, ReactNode } from 'react';
import { VisuallyHidden } from './VisuallyHidden';

export interface Column<T> {
  /** Unique within the table. */
  key: string;
  /** The column's name: shown in the header, and how screen readers name each cell. */
  header: string;
  /** Keep the header for screen readers but don't show it (e.g. "Actions"). */
  hideHeader?: boolean;
  cell: (row: T) => ReactNode;
  /** This column names the row (e.g. the card name), so its cells are row headers. */
  rowHeader?: boolean;
  /** Class for the column's cells. */
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  rowClassName?: (row: T) => string;
  /** A visible title; otherwise give the table a label. */
  caption?: ReactNode;
  'aria-label'?: string;
  className?: string;
}

/**
 * Rows of data under column headers, as a real <table>: screen readers can move by row and
 * column and hear each cell's header. Every row has a cell for every column, so rows never
 * fall out of line with the header.
 */
export function DataTable<T>({ columns, rows, rowKey, rowClassName, caption, className, ...label }: DataTableProps<T>) {
  return (
    <table className={['data-table', className].filter(Boolean).join(' ')} {...label}>
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col">
              {c.hideHeader ? <VisuallyHidden>{c.header}</VisuallyHidden> : c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className={rowClassName?.(row)}>
            {columns.map((c) =>
              c.rowHeader ? (
                <th key={c.key} scope="row" className={c.className}>
                  {c.cell(row)}
                </th>
              ) : (
                <td key={c.key} className={c.className}>
                  {c.cell(row)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
