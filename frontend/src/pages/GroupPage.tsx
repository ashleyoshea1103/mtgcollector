import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useChangeGroup, useCustomGroup, useDeleteGroup } from '../api/queries';
import { GroupForm } from '../components/GroupForm';
import { ListingControls } from '../components/ListingControls';
import { RateNote } from '../components/RateNote';
import { TotalValue } from '../components/TotalValue';
import { countOf } from '../lib/format';
import { groupChange } from '../lib/groups';
import { parseId } from '../lib/ids';
import { GROUP_KINDS, labelFor } from '../lib/labels';
import { readListing, writeListing } from '../lib/listingParams';
import { errorMessage, isNotFound } from '../lib/messages';
import type { CustomGroup } from '../types';
import { Button, Cluster, Dialog, EmptyState, ErrorState, FormError, Loading, Stack, toast } from '../ui';
import { Listing } from './Listing';
import { MemberActions } from './MemberActions';
import { NotFoundPage } from './NotFoundPage';

const backToGroups = { to: '/groups', label: 'See your groups' };

/** One custom group: what it is, its totals, and its cards, listed as the collection is. */
export function GroupPage() {
  const id = parseId(useParams().id);
  if (id === null) return <NotFoundPage thing="group" back={backToGroups} />;
  // Another group is another page: nothing typed or opened carries over.
  return <GroupView key={id} id={id} />;
}

function GroupView({ id }: { id: number }) {
  const group = useCustomGroup(id);
  const [params, setParams] = useSearchParams();
  const listing = readListing(params);

  if (group.isError && (group.data === undefined || isNotFound(group.error))) {
    if (isNotFound(group.error)) return <NotFoundPage thing="group" back={backToGroups} />;
    return <ErrorState message={errorMessage(group.error)} onRetry={() => void group.refetch()} />;
  }
  if (group.data === undefined) return <Loading />;
  const g = group.data;

  return (
    <Stack as="section" className={`group-page group-page--${g.kind}`} gap={5}>
      <title>{`${g.name} · mtgcollector`}</title>
      <header className="group-page__header">
        <Cluster justify="space-between">
          <h1>{g.name}</h1>
          <GroupChanges group={g} />
        </Cluster>
        <Cluster as="p" className="group-page__meta">
          <span>{labelFor(GROUP_KINDS, g.kind)}</span>
          <span>{countOf(g.card_count, 'card')}</span>
          <TotalValue total={g} />
        </Cluster>
        {g.description && <p className="group-page__description">{g.description}</p>}
      </header>
      <RateNote />
      {/* The same page, so it stays where it's scrolled to. */}
      <ListingControls value={listing} onChange={(next) => setParams(writeListing(params, next), { replace: true, preventScrollReset: true })} />
      <Listing
        listing={id}
        params={listing}
        renderActions={(row) => <MemberActions groupId={id} groupName={g.name} row={row} />}
        empty={
          <EmptyState title={`No cards in ${g.name} yet`}>
            Put cards in it from <Link to="/collection">your collection</Link> (each card's Actions menu), or choose it when adding cards from{' '}
            <Link to="/search">the search</Link>.
          </EmptyState>
        }
      />
    </Stack>
  );
}

/** Changing the group's name, kind or description, and deleting it. */
function GroupChanges({ group }: { group: CustomGroup }) {
  const [open, setOpen] = useState<'change' | 'delete' | null>(null);
  const change = useChangeGroup();
  const remove = useDeleteGroup();
  const navigate = useNavigate();
  const close = () => {
    setOpen(null);
    change.reset();
    remove.reset();
  };
  const before = { name: group.name, kind: group.kind, description: group.description };

  return (
    <Cluster className="group-page__actions">
      <Button onPress={() => setOpen('change')}>Change…</Button>
      <Button variant="danger" onPress={() => setOpen('delete')}>
        Delete…
      </Button>
      {open === 'change' && (
        <Dialog title={`Change ${group.name}`} isOpen onOpenChange={(o) => !o && close()}>
          <GroupForm
            group={before}
            onCancel={close}
            submitting={change.isPending}
            error={change.isError ? errorMessage(change.error) : undefined}
            onSubmit={(values) => {
              const c = groupChange(before, values);
              if (Object.keys(c).length === 0) return close();
              change.mutate(
                { id: group.id, change: c },
                {
                  onSuccess: (changed) => {
                    toast({ title: `Saved ${changed.name}`, tone: 'success' });
                    close();
                  },
                },
              );
            }}
          />
        </Dialog>
      )}
      {open === 'delete' && (
        <Dialog role="alertdialog" title={`Delete ${group.name}?`} isOpen onOpenChange={(o) => !o && close()}>
          <Stack>
            <p>The group goes; its cards stay in your collection.</p>
            {remove.isError && <FormError>{errorMessage(remove.error)}</FormError>}
            <Cluster>
              <Button onPress={close}>Cancel</Button>
              <Button
                variant="danger"
                busy={remove.isPending}
                onPress={() =>
                  remove.mutate(group.id, {
                    onSuccess: () => {
                      toast({ title: `Deleted ${group.name}`, tone: 'success' });
                      navigate('/groups', { replace: true });
                    },
                  })
                }
              >
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Cluster>
  );
}
