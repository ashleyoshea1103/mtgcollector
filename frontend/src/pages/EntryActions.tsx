import { useState } from 'react';
import { Link } from 'react-router';
import { useChangeEntry, useCustomGroups, useDeleteEntry, useGroupMember, useSetGroupMember } from '../api/queries';
import { EntryChangeForm } from '../components/EntryChangeForm';
import { MemberForm } from '../components/MemberForm';
import { describeEntry } from '../lib/entries';
import { errorMessage } from '../lib/messages';
import type { CollectionEntry } from '../types';
import { Button, Cluster, Dialog, EmptyState, ErrorState, Loading, Menu, MenuItem, Stack, toast, VisuallyHidden } from '../ui';

type Action = 'change' | 'group' | 'remove';

/** What can be done with an entry of the collection: change it, put copies in a group, or remove it. */
export function EntryActions({ entry }: { entry: CollectionEntry }) {
  const [action, setAction] = useState<Action | null>(null);
  const close = () => setAction(null);
  return (
    <>
      <Menu
        trigger={
          <Button variant="ghost" className="entry-actions">
            Actions <VisuallyHidden>for {entry.card.name}</VisuallyHidden>
          </Button>
        }
        onAction={(id) => setAction(id as Action)}
      >
        <MenuItem id="change">Change…</MenuItem>
        <MenuItem id="group">Put in a group…</MenuItem>
        <MenuItem id="remove" danger>
          Remove…
        </MenuItem>
      </Menu>
      {action === 'change' && <ChangeEntryDialog entry={entry} onClose={close} />}
      {action === 'group' && <PutInGroupDialog entry={entry} onClose={close} />}
      {action === 'remove' && <RemoveEntryDialog entry={entry} onClose={close} />}
    </>
  );
}

interface DialogProps {
  entry: CollectionEntry;
  onClose: () => void;
}

function ChangeEntryDialog({ entry, onClose }: DialogProps) {
  const change = useChangeEntry();
  return (
    <Dialog title={`Change ${entry.card.name}`} isOpen onOpenChange={(open) => !open && onClose()}>
      <EntryChangeForm
        entry={entry}
        onCancel={onClose}
        submitting={change.isPending}
        error={change.isError ? errorMessage(change.error) : undefined}
        onSubmit={(c) => {
          if (Object.keys(c).length === 0) return onClose();
          change.mutate(
            { id: entry.id, change: c },
            {
              onSuccess: (changed) => {
                toast({ title: `Saved ${describeEntry(changed)}`, tone: 'success' });
                onClose();
              },
            },
          );
        }}
      />
    </Dialog>
  );
}

function PutInGroupDialog({ entry, onClose }: DialogProps) {
  const groups = useCustomGroups();
  const [chosen, setChosen] = useState<number | null>(null);
  // The first group until one is chosen; a chosen group deleted meanwhile falls back to it too.
  const groupId = groups.data?.some((g) => g.id === chosen) ? chosen : (groups.data?.[0]?.id ?? null);
  const member = useGroupMember(groupId, entry.id);
  const put = useSetGroupMember();

  return (
    <Dialog title={`Put ${entry.card.name} in a group`} isOpen onOpenChange={(open) => !open && onClose()}>
      {groups.isPending ? (
        <Loading />
      ) : groups.isError ? (
        <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState title="You have no groups yet" action={<Link to="/groups">Make a group</Link>}>
          Binders, decks and boxes hold some of your cards.
        </EmptyState>
      ) : (
        <MemberForm
          entry={entry}
          groups={groups.data}
          groupId={groupId}
          onGroupChange={setChosen}
          current={member.isSuccess ? (member.data?.quantity ?? null) : undefined}
          onCancel={onClose}
          submitting={put.isPending}
          error={put.isError ? errorMessage(put.error) : undefined}
          onSubmit={(quantity) =>
            put.mutate(
              { groupId: groupId!, entryId: entry.id, quantity },
              {
                onSuccess: ({ member: m }) => {
                  const name = groups.data.find((g) => g.id === groupId)?.name ?? 'the group';
                  toast({ title: `${name} now holds ${m.quantity} × ${entry.card.name}`, tone: 'success' });
                  onClose();
                },
              },
            )
          }
        />
      )}
    </Dialog>
  );
}

function RemoveEntryDialog({ entry, onClose }: DialogProps) {
  const remove = useDeleteEntry();
  return (
    <Dialog role="alertdialog" title={`Remove ${entry.card.name}?`} isOpen onOpenChange={(open) => !open && onClose()}>
      <Stack>
        <p>{describeEntry(entry)} will leave your collection, and any groups they're in.</p>
        {remove.isError && <p role="alert">{errorMessage(remove.error)}</p>}
        <Cluster>
          <Button onPress={onClose}>Cancel</Button>
          <Button
            variant="danger"
            busy={remove.isPending}
            onPress={() =>
              remove.mutate(entry.id, {
                onSuccess: () => {
                  toast({ title: `Removed ${describeEntry(entry)}`, tone: 'success' });
                  onClose();
                },
              })
            }
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </Cluster>
      </Stack>
    </Dialog>
  );
}
