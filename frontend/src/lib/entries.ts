import type { CollectionEntry, EntryChange } from '../types';
import { CONDITIONS, FINISHES, labelFor, LANGUAGES } from './labels';

export type EntryValues = Required<EntryChange>;

/** What changed about an entry: only those fields are sent, so a change can't undo someone else's. */
export function entryChange(entry: CollectionEntry, after: EntryValues): EntryChange {
  const change: EntryChange = {};
  if (after.quantity !== entry.quantity) change.quantity = after.quantity;
  if (after.finish !== entry.finish) change.finish = after.finish;
  if (after.condition !== entry.condition) change.condition = after.condition;
  if (after.language !== entry.language) change.language = after.language;
  return change;
}

/** "4 × Lightning Bolt (Foil, Near Mint, Japanese)" */
export const describeEntry = (e: CollectionEntry) =>
  `${e.quantity} × ${e.card.name} (${labelFor(FINISHES, e.finish)}, ${labelFor(CONDITIONS, e.condition)}, ${labelFor(LANGUAGES, e.language)})`;
