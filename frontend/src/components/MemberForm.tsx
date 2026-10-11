import { useState, type FormEvent } from 'react';
import { countOf } from '../lib/format';
import { parseQuantity } from '../lib/quantity';
import type { CollectionEntry, CustomGroup } from '../types';
import { Button, Cluster, Field, NumberInput, Select, Stack } from '../ui';

interface Props {
  /** The entry whose copies go in the group: its quantity is the most the group can hold. */
  entry: CollectionEntry;
  /** The groups to choose from. Leave out when the group is already chosen (changing its copies). */
  groups?: CustomGroup[];
  groupId: number | null;
  onGroupChange?: (groupId: number) => void;
  /** Copies of the entry the chosen group holds now: null for none, undefined while unknown. */
  current?: number | null;
  /** Called with how many copies the group should hold. */
  onSubmit: (quantity: number) => void;
  onCancel?: () => void;
  submitting?: boolean;
  /** Why the last attempt failed. */
  error?: string;
}

/** How many of an entry's copies are in a group (a binder can hold some of them), and which group. */
export function MemberForm({ entry, groups, groupId, onGroupChange, current, onSubmit, onCancel, submitting = false, error }: Props) {
  // What was typed, for the group it was typed for: choosing another group starts from what that one holds.
  const [typed, setTyped] = useState<{ groupId: number | null; value: string } | null>(null);
  const quantity = typed?.groupId === groupId ? typed.value : String(current ?? 1);
  const held = current === undefined ? '' : current === null ? ' It has none now.' : ` It has ${current} now.`;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || groupId === null) return;
    onSubmit(parseQuantity(quantity, entry.quantity));
  }

  return (
    <form className="member-form" onSubmit={handleSubmit}>
      <Stack>
        {groups && (
          <Field label="Group">
            <Select
              options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
              value={groupId === null ? '' : String(groupId)}
              onChange={(v) => onGroupChange?.(Number(v))}
            />
          </Field>
        )}
        <Field label="Copies in the group" description={`Up to ${countOf(entry.quantity, 'copy', 'copies')}, all you have.${held}`}>
          <NumberInput min={1} max={entry.quantity} value={quantity} onChange={(e) => setTyped({ groupId, value: e.target.value })} />
        </Field>
        {error && (
          <p className="member-form__error" role="alert">
            {error}
          </p>
        )}
        <Cluster as="footer" className="member-form__actions">
          {onCancel && <Button onPress={onCancel}>Cancel</Button>}
          <Button type="submit" variant="primary" busy={submitting} isDisabled={groupId === null}>
            {submitting ? 'Saving…' : current ? 'Save' : 'Add to group'}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
