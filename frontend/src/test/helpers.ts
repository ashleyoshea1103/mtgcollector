import { within } from '@testing-library/react';
import { formatPrice } from '../lib/price';

/**
 * How a EUR / USD amount is displayed, in whatever locale the tests run in.
 * Whitespace is normalised the way Testing Library normalises text, because
 * many locales put a non-breaking space between the amount and the symbol.
 */
const normalise = (s: string) => s.replace(/\s+/g, ' ');
export const eur = (amount: number | null) => (amount == null ? '—' : normalise(formatPrice(amount)));
export const usd = (amount: number | null) => (amount == null ? '—' : normalise(formatPrice(amount, 'usd')));

/** A table row's cells keyed by their column header text, so assertions can't hit the wrong column. */
export function cellsByColumn(row: HTMLElement): Record<string, HTMLElement> {
  const table = row.closest('table')!;
  const headers = within(table.querySelector('thead')!)
    .getAllByRole('columnheader')
    .map((th) => th.textContent || th.getAttribute('aria-label') || '');
  const cells = [...row.querySelectorAll<HTMLElement>(':scope > th, :scope > td')];
  return Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
}

/**
 * The elements showing `text` as their tooltip (src/ui TooltipText), within a scope. Tooltips
 * replaced title=, so this is how tests find "the abbreviation for Near Mint".
 */
export function queryAllByTooltip(scope: ParentNode, text: string): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-tooltip]')].filter((el) => el.dataset.tooltip === text);
}
export function queryByTooltip(scope: ParentNode, text: string): HTMLElement | null {
  const found = queryAllByTooltip(scope, text);
  if (found.length > 1) throw new Error(`${found.length} elements have the tooltip "${text}"`);
  return found[0] ?? null;
}
export function getAllByTooltip(scope: ParentNode, text: string): HTMLElement[] {
  const found = queryAllByTooltip(scope, text);
  if (found.length === 0) throw new Error(`No element has the tooltip "${text}"`);
  return found;
}
export function getByTooltip(scope: ParentNode, text: string): HTMLElement {
  const found = queryByTooltip(scope, text);
  if (!found) throw new Error(`No element has the tooltip "${text}"`);
  return found;
}
