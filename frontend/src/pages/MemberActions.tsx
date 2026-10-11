import { useState } from 'react';
import type { ListedEntry } from '../api/queries';
import { useRemoveGroupMember, useSetGroupMember } from '../api/queries';
import { MemberForm } from '../components/MemberForm';
import { errorMessage } from '../lib/messages';
import type { GroupMember } from '../types';
import { Button, Dialog, Menu, MenuItem, toast, VisuallyHidden } from '../ui';

interface Props {
  groupId: number;
  groupName: string;
  row: ListedEntry;
}

/** What can be done with a card in a group: change how many copies it holds, or take it out. */
export function MemberActions({ groupId, groupName, row }: Props) {
  const [changing, setChanging] = useState(false);
  const remove = useRemoveGroupMember();
  const member = row.member;
  if (!member) return null;
  const name = member.entry.card.name;

  function takeOut() {
    remove.mutate(
      { groupId, entryId: member!.entry.id },
      {
        onSuccess: () => toast({ title: `Took ${name} out of ${groupName}`, description: 'It stays in your collection.', tone: 'success' }),
        onError: (err) => toast({ title: `Couldn't take ${name} out`, description: errorMessage(err), tone: 'error' }),
      },
    );
  }

  return (
    <>
      <Menu
        trigger={
          <Button variant="ghost" className="member-actions" busy={remove.isPending}>
            Actions <VisuallyHidden>for {name}</VisuallyHidden>
          </Button>
        }
        onAction={(id) => (id === 'change' ? setChanging(true) : takeOut())}
      >
        <MenuItem id="change">Change copies…</MenuItem>
        <MenuItem id="remove">Take out of the group</MenuItem>
      </Menu>
      {changing && <ChangeCopiesDialog groupId={groupId} groupName={groupName} member={member} onClose={() => setChanging(false)} />}
    </>
  );
}

function ChangeCopiesDialog({ groupId, groupName, member, onClose }: { groupId: number; groupName: string; member: GroupMember; onClose: () => void }) {
  const put = useSetGroupMember();
  const name = member.entry.card.name;
  return (
    <Dialog title={`Copies of ${name} in ${groupName}`} isOpen onOpenChange={(open) => !open && onClose()}>
      <MemberForm
        entry={member.entry}
        groupId={groupId}
        current={member.quantity}
        onCancel={onClose}
        submitting={put.isPending}
        error={put.isError ? errorMessage(put.error) : undefined}
        onSubmit={(quantity) => {
          if (quantity === member.quantity) return onClose();
          put.mutate(
            { groupId, entryId: member.entry.id, quantity },
            {
              onSuccess: () => {
                toast({ title: `${groupName} now holds ${quantity} × ${name}`, tone: 'success' });
                onClose();
              },
            },
          );
        }}
      />
    </Dialog>
  );
}
