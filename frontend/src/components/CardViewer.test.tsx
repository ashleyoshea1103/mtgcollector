import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards } from '../fixtures';
import type { CardSummary } from '../types';
import { CardViewer } from './CardViewer';

const { lightningBolt, delver, fireIce, propaganda } = cards;
// What a listing carries: no faces, only the front image.
const { faces: _faces, ...delverSummary } = delver;
const summary: CardSummary = delverSummary;

const open = (card: CardSummary, onOpenChange = vi.fn<(open: boolean) => void>()) => {
  render(<CardViewer card={card} isOpen onOpenChange={onOpenChange} details={<a href="/cards/x">Card details</a>} />);
  return { dialog: screen.getByRole('dialog', { name: card.name }), onOpenChange };
};

describe('CardViewer', () => {
  it('shows the card large, named, with its printing and a link to its page', () => {
    const { dialog } = open(lightningBolt);
    expect(within(dialog).getByRole('img', { name: lightningBolt.name })).toHaveAttribute('src', lightningBolt.images!.large);
    expect(dialog).toHaveTextContent(lightningBolt.set.name);
    expect(dialog).toHaveTextContent(`#${lightningBolt.collector_number}`);
    expect(within(dialog).getByRole('link', { name: 'Card details' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Turn over' })).not.toBeInTheDocument();
  });

  it("shows the tile's smaller image, already loaded, while the large one comes", () => {
    const { dialog } = open(delver);
    const standIns = [...dialog.querySelectorAll<HTMLImageElement>('.card-viewer__stand-in img')].map((img) => img.getAttribute('src'));
    expect(standIns).toEqual(delver.faces!.map((f) => f.images!.normal));
    // Under the large one, and not read out: the large one is the card.
    expect(within(dialog).getAllByRole('img')).toHaveLength(1);
  });

  it('closes from its close button and from Escape', async () => {
    const { dialog, onOpenChange } = open(lightningBolt);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('turns a double-faced card over, and back', async () => {
    const { dialog } = open(delver);
    const [front, back] = delver.faces!;
    const shown = () => within(dialog).getByRole('img');
    expect(shown()).toHaveAccessibleName(front.name);
    expect(shown()).toHaveAttribute('src', front.images!.large);
    expect(dialog).toHaveTextContent('Front face');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn over' }));
    expect(shown()).toHaveAccessibleName(back.name);
    expect(shown()).toHaveAttribute('src', back.images!.large);
    expect(dialog).toHaveTextContent('Back face');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn over' }));
    expect(shown()).toHaveAccessibleName(front.name);
  });

  it('says which face is showing as it turns, for screen readers too', async () => {
    const { dialog } = open(delver);
    const side = within(dialog).getByText('Front face');
    expect(side).toHaveAttribute('aria-live', 'polite');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn over' }));
    expect(side).toHaveTextContent('Back face');
  });

  it('starts every card it is given on its front', async () => {
    const { rerender } = render(<CardViewer card={delver} isOpen onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn over' }));
    rerender(<CardViewer card={propaganda} isOpen onOpenChange={() => {}} />);
    expect(within(screen.getByRole('dialog')).getByText('Front face')).toBeInTheDocument();
  });

  it("doesn't offer to turn over a card whose halves are on one side (Fire // Ice)", () => {
    const { dialog } = open(fireIce);
    expect(within(dialog).queryByRole('button', { name: 'Turn over' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: fireIce.name })).toHaveAttribute('src', fireIce.images!.large);
  });

  it("shows just the front of a card it only has the summary of, until it's given the whole card", () => {
    const { dialog } = open(summary);
    expect(within(dialog).getByRole('img', { name: summary.name })).toHaveAttribute('src', summary.images!.large);
    expect(within(dialog).queryByRole('button', { name: 'Turn over' })).not.toBeInTheDocument();
  });
});
