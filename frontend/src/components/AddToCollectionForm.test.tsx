import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, customGroups } from '../fixtures';
import { AddToCollectionForm } from './AddToCollectionForm';

describe('AddToCollectionForm', () => {
  it('submits one near-mint English copy by default', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={cards.lightningBolt} onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Add to collection' }));

    expect(onSubmit).toHaveBeenCalledWith({
      card_id: cards.lightningBolt.id,
      quantity: 1,
      finish: 'nonfoil',
      condition: 'NM',
      language: 'en',
      group_id: null,
    });
  });

  it('submits what the user picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={cards.fireIce} groups={customGroups} onSubmit={onSubmit} />);

    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Finish' }), 'etched');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Condition' }), 'LP');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'ja');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Add to group' }), 'Izzet Tempo');
    await user.click(screen.getByRole('button', { name: 'Add to collection' }));

    expect(onSubmit).toHaveBeenCalledWith({
      card_id: cards.fireIce.id,
      quantity: 3,
      finish: 'etched',
      condition: 'LP',
      language: 'ja',
      group_id: 2,
    });
  });

  it('only offers the finishes the printing exists in', () => {
    render(<AddToCollectionForm card={cards.lightningBolt} onSubmit={() => {}} />);
    const options = within(screen.getByRole('combobox', { name: 'Finish' })).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Non-foil', 'Foil']);
  });

  it('shows the unit price for the chosen finish', async () => {
    const user = userEvent.setup();
    render(<AddToCollectionForm card={cards.ragavan} onSubmit={() => {}} />);
    expect(screen.getByText(/Adding/)).toHaveTextContent(/34[.,]19/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Finish' }), 'foil');
    expect(screen.getByText(/Adding/)).toHaveTextContent(/53[.,]92/);
  });

  it('never submits a quantity below one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={cards.lightningBolt} onSubmit={onSubmit} />);
    await user.clear(screen.getByRole('spinbutton', { name: 'Quantity' }));
    await user.click(screen.getByRole('button', { name: 'Add to collection' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });

  it('hides the group picker when the user has no groups', () => {
    render(<AddToCollectionForm card={cards.lightningBolt} onSubmit={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Add to group' })).not.toBeInTheDocument();
  });

  it('disables the button while submitting', () => {
    render(<AddToCollectionForm card={cards.lightningBolt} onSubmit={() => {}} submitting />);
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });
});
