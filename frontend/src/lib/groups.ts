import { MaxGroupDescriptionLength, MaxGroupNameLength, type GroupChange, type NewGroup } from '../types';

/**
 * A group's name or description as the server stores it: trimmed, in NFC. Its length is
 * counted in Unicode code points, as the server counts it ([...s], not s.length).
 */
export const tidy = (s: string) => s.trim().normalize('NFC');
export const characters = (s: string) => [...tidy(s)].length;

/** What's wrong with a group's name and description, if anything, before sending them. */
export function groupProblems(g: Pick<NewGroup, 'name' | 'description'>): { name?: string; description?: string } {
  const problems: { name?: string; description?: string } = {};
  if (characters(g.name) === 0) problems.name = 'Give the group a name.';
  else if (characters(g.name) > MaxGroupNameLength) problems.name = `Use at most ${MaxGroupNameLength} characters.`;
  if (characters(g.description) > MaxGroupDescriptionLength) problems.description = `Use at most ${MaxGroupDescriptionLength} characters.`;
  return problems;
}

/** What changed between a group and the form's values: only those fields are sent, so a change can't undo someone else's. */
export function groupChange(before: NewGroup, after: NewGroup): GroupChange {
  const change: GroupChange = {};
  if (tidy(after.name) !== tidy(before.name)) change.name = tidy(after.name);
  if (after.kind !== before.kind) change.kind = after.kind;
  if (tidy(after.description) !== tidy(before.description)) change.description = tidy(after.description);
  return change;
}
