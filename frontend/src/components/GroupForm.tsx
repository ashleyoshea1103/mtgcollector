import { useState, type FormEvent } from 'react';
import { groupProblems } from '../lib/groups';
import { GROUP_KINDS } from '../lib/labels';
import { MaxGroupDescriptionLength, MaxGroupNameLength, type CustomGroupKind, type NewGroup } from '../types';
import { Button, Cluster, Field, Select, Stack, TextArea, TextInput } from '../ui';

interface Props {
  /** The group being changed; leave out to make a new one. */
  group?: NewGroup;
  /** Called with the form's values, trimmed by the server when stored. */
  onSubmit: (values: NewGroup) => void;
  onCancel?: () => void;
  submitting?: boolean;
  /** Why the last attempt failed, e.g. a name already in use. */
  error?: string;
}

const KIND_OPTIONS = Object.entries(GROUP_KINDS).map(([value, label]) => ({ value: value as CustomGroupKind, label }));

/** A group's name, kind and description, for making a group or changing one. */
export function GroupForm({ group, onSubmit, onCancel, submitting = false, error }: Props) {
  // Only the form's own fields, though a whole CustomGroup may be passed.
  const [values, setValues] = useState<NewGroup>(group ? { name: group.name, kind: group.kind, description: group.description } : { name: '', kind: 'binder', description: '' });
  const [checked, setChecked] = useState(false);
  const problems = checked ? groupProblems(values) : {};
  const editing = group !== undefined;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setChecked(true);
    if (Object.keys(groupProblems(values)).length > 0) return;
    onSubmit(values);
  }

  return (
    <form className="group-form" onSubmit={handleSubmit}>
      <Stack>
        <Field label="Name" description={`Up to ${MaxGroupNameLength} characters.`} error={problems.name}>
          <TextInput required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </Field>
        <Field label="Kind">
          <Select options={KIND_OPTIONS} value={values.kind} onChange={(kind) => setValues({ ...values, kind })} />
        </Field>
        <Field label="Description" description={`Optional. Up to ${MaxGroupDescriptionLength} characters.`} error={problems.description}>
          <TextArea rows={3} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} />
        </Field>
        {error && (
          <p className="group-form__error" role="alert">
            {error}
          </p>
        )}
        <Cluster as="footer" className="group-form__actions">
          {onCancel && <Button onPress={onCancel}>Cancel</Button>}
          <Button type="submit" variant="primary" busy={submitting}>
            {submitting ? 'Saving…' : editing ? 'Save' : 'Make group'}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
