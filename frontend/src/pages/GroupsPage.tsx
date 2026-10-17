import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateGroup, useCustomGroups } from '../api/queries';
import { CustomGroupCard } from '../components/CustomGroupCard';
import { GroupForm } from '../components/GroupForm';
import { RateNote } from '../components/RateNote';
import { errorMessage } from '../lib/messages';
import { groupPath } from '../lib/paths';
import { Button, Cluster, Dialog, EmptyState, ErrorState, Grid, Loading, Stack, toast } from '../ui';

/** The user's binders, decks and boxes, and a way to make another. */
export function GroupsPage() {
  const groups = useCustomGroups();
  const create = useCreateGroup();
  const navigate = useNavigate();
  const [making, setMaking] = useState(false);

  const close = () => {
    setMaking(false);
    create.reset();
  };
  const newGroup = (
    <Button variant="primary" onPress={() => setMaking(true)}>
      New group
    </Button>
  );

  return (
    <Stack as="section" className="groups-page" gap={5}>
      <title>Groups · mtgcollector</title>
      <Cluster justify="space-between">
        <h1>Groups</h1>
        {groups.data && groups.data.length > 0 && newGroup}
      </Cluster>
      {groups.data === undefined ? (
        groups.isError ? (
          <ErrorState message={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
        ) : (
          <Loading />
        )
      ) : groups.data.length === 0 ? (
        <EmptyState title="No groups yet" action={newGroup}>
          Make a binder, deck or box, then put cards from your collection in it.
        </EmptyState>
      ) : (
        <>
          <RateNote />
          <h2 className="visually-hidden">Your groups</h2>
          <Grid as="ul" minItemWidth="260px" className="group-grid">
            {groups.data.map((g) => (
              <li key={g.id}>
                <CustomGroupCard
                  group={g}
                  actions={
                    <Link to={groupPath(g.id)} aria-label={`Open ${g.name}`}>
                      Open
                    </Link>
                  }
                />
              </li>
            ))}
          </Grid>
        </>
      )}
      {making && (
        <Dialog title="New group" isOpen onOpenChange={(open) => !open && close()}>
          <GroupForm
            onCancel={close}
            submitting={create.isPending}
            error={create.isError ? errorMessage(create.error) : undefined}
            onSubmit={(values) =>
              create.mutate(values, {
                onSuccess: (group) => {
                  toast({ title: `Made ${group.name}`, tone: 'success' });
                  navigate(groupPath(group.id));
                },
              })
            }
          />
        </Dialog>
      )}
    </Stack>
  );
}
