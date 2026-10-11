import { useState } from 'react';
import { useAddEntry, useCustomGroups, usePrintings } from '../api/queries';
import { AddToCollectionForm } from '../components/AddToCollectionForm';
import { PrintingOption } from '../components/PrintingOption';
import { errorMessage } from '../lib/messages';
import type { CardSummary } from '../types';
import { Button, Dialog, ErrorState, FormError, Loading, Stack, toast } from '../ui';

interface Props {
  card: CardSummary;
  /** Offer the card's other printings too (from search results, where the printing shown is only the likeliest). */
  pickPrinting?: boolean;
  onClose: () => void;
}

/** Adding copies of a card to the collection, and optionally to one of the user's groups. */
export function AddCardDialog({ card, pickPrinting = false, onClose }: Props) {
  const [chosen, setChosen] = useState(card);
  const printings = usePrintings(card.id, pickPrinting);
  const groups = useCustomGroups();
  const add = useAddEntry();

  return (
    <Dialog title={`Add ${card.name}`} className="add-card-dialog" isOpen onOpenChange={(open) => !open && onClose()}>
      <Stack>
        {pickPrinting && (
          <section className="add-card-dialog__printings" aria-label="Printings">
            <h3>Which printing?</h3>
            {printings.isPending ? (
              <Loading label="Loading printings…" />
            ) : printings.isError ? (
              <ErrorState message={errorMessage(printings.error)} onRetry={() => void printings.refetch()} />
            ) : (
              <div className="printing-list">
                {printings.data.map((p) => (
                  <PrintingOption key={p.id} card={p} selected={p.id === chosen.id} onSelect={setChosen} />
                ))}
              </div>
            )}
            {printings.hasNextPage && (
              <Button onPress={() => void printings.fetchNextPage()} busy={printings.isFetchingNextPage}>
                {printings.isFetchingNextPage ? 'Loading…' : 'More printings'}
              </Button>
            )}
          </section>
        )}
        <AddToCollectionForm
          card={chosen}
          groups={groups.data ?? []}
          submitting={add.isPending}
          onSubmit={(entry) =>
            add.mutate(entry, {
              onSuccess: ({ entry: saved, created }) => {
                const group = groups.data?.find((g) => g.id === entry.group_id);
                toast({
                  title: created ? `Added ${entry.quantity} × ${saved.card.name}` : `Added ${entry.quantity} more × ${saved.card.name}, now ${saved.quantity}`,
                  description: group ? `Also in ${group.name}.` : undefined,
                  tone: 'success',
                });
                onClose();
              },
            })
          }
        />
        {add.isError && <FormError className="add-card-dialog__error">{errorMessage(add.error)}</FormError>}
        <Button className="add-card-dialog__cancel" onPress={onClose}>
          Cancel
        </Button>
      </Stack>
    </Dialog>
  );
}
