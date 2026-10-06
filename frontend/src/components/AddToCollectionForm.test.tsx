import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, customGroups } from '../fixtures';
import { LANGUAGES } from '../lib/labels';
import { eur } from '../test/helpers';
import { AddToCollectionForm } from './AddToCollectionForm';

const { lightningBolt, fireIce, ragavan, propaganda } = cards;
const select = (name: string) => screen.getByRole('combobox', { name });
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Add to collection' }));

describe('AddToCollectionForm', () => {
  it('submits one near-mint English copy by default', async () => {
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={lightningBolt} onSubmit={onSubmit} />);
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      card_id: lightningBolt.id,
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
    render(<AddToCollectionForm card={fireIce} groups={customGroups} onSubmit={onSubmit} />);

    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.selectOptions(select('Finish'), 'etched');
    await user.selectOptions(select('Condition'), 'LP');
    await user.selectOptions(select('Language'), 'ph');
    await user.selectOptions(select('Add to group'), 'Izzet Tempo');
    await user.click(screen.getByRole('button', { name: 'Add to collection' }));

    expect(onSubmit).toHaveBeenCalledWith({
      card_id: fireIce.id,
      quantity: 3,
      finish: 'etched',
      condition: 'LP',
      language: 'ph',
      group_id: customGroups.find((g) => g.name === 'Izzet Tempo')!.id,
    });
  });

  it('lists every condition and language with its full name', () => {
    render(<AddToCollectionForm card={lightningBolt} onSubmit={() => {}} />);
    const optionText = (name: string) => within(select(name)).getAllByRole('option').map((o) => o.textContent);
    expect(optionText('Condition')).toEqual([
      'MT: Mint',
      'NM: Near Mint',
      'EX: Excellent',
      'GD: Good',
      'LP: Light Played',
      'PL: Played',
      'PO: Poor',
    ]);
    expect(optionText('Language')).toEqual(Object.values(LANGUAGES));
  });

  it('only offers the finishes the printing exists in', () => {
    render(<AddToCollectionForm card={lightningBolt} onSubmit={() => {}} />);
    const options = within(select('Finish')).getAllByRole('option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(lightningBolt.finishes);
    expect(options.map((o) => o.textContent)).toEqual(['Non-foil', 'Foil']);
  });

  it('defaults a foil-only printing to foil', async () => {
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={propaganda} onSubmit={onSubmit} />);
    expect(select('Finish')).toHaveValue('foil');
    expect(screen.getByText(/Adding/)).toHaveTextContent(eur(propaganda.prices.eur_foil));
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ finish: 'foil' }));
  });

  it('falls back to a valid finish when the card changes to one without the chosen finish', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<AddToCollectionForm card={fireIce} onSubmit={onSubmit} />);
    await user.selectOptions(select('Finish'), 'etched');

    rerender(<AddToCollectionForm card={lightningBolt} onSubmit={onSubmit} />);
    expect(select('Finish')).toHaveValue('nonfoil');
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ card_id: lightningBolt.id, finish: 'nonfoil' }));
  });

  it('drops a chosen group that no longer exists, and "None" clears the group', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<AddToCollectionForm card={lightningBolt} groups={customGroups} onSubmit={onSubmit} />);
    await user.selectOptions(select('Add to group'), 'Trade binder');
    await user.selectOptions(select('Add to group'), 'None');
    await submit();
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ group_id: null }));

    await user.selectOptions(select('Add to group'), 'Trade binder');
    rerender(<AddToCollectionForm card={lightningBolt} groups={customGroups.filter((g) => g.name !== 'Trade binder')} onSubmit={onSubmit} />);
    await submit();
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ group_id: null }));
  });

  it('shows the unit price for the chosen finish', async () => {
    const user = userEvent.setup();
    render(<AddToCollectionForm card={ragavan} onSubmit={() => {}} />);
    expect(screen.getByText(/Adding/)).toHaveTextContent(eur(ragavan.prices.eur));
    await user.selectOptions(select('Finish'), 'foil');
    expect(screen.getByText(/Adding/)).toHaveTextContent(eur(ragavan.prices.eur_foil));
  });

  it('submits an emptied quantity as one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={lightningBolt} onSubmit={onSubmit} />);
    await user.clear(screen.getByRole('spinbutton', { name: 'Quantity' }));
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1 }));
  });

  it.each(['2.5', '0', '1000'])('lets the browser block an invalid quantity of %s', async (typed) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AddToCollectionForm card={lightningBolt} onSubmit={onSubmit} />);
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    await user.clear(quantity);
    await user.type(quantity, typed);
    await submit();
    expect(quantity).toBeInvalid();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the group picker when the user has no groups', () => {
    render(<AddToCollectionForm card={lightningBolt} onSubmit={() => {}} />);
    expect(screen.queryByRole('combobox', { name: 'Add to group' })).not.toBeInTheDocument();
  });

  it('disables the button while submitting', () => {
    render(<AddToCollectionForm card={lightningBolt} onSubmit={() => {}} submitting />);
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });
});
