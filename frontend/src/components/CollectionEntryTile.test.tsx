import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, entries } from '../fixtures';
import { eur } from '../test/helpers';
import { CardTile } from './CardTile';
import { CollectionEntryTile } from './CollectionEntryTile';

const { lightningBolt, propaganda } = cards;

describe('CardTile', () => {
  it('shows the name, printing, non-foil price and actions', () => {
    render(<CardTile card={lightningBolt} actions={<button type="button">Add</button>} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByRole('heading', { name: lightningBolt.name })).toBeInTheDocument();
    expect(within(tile).getByTitle(lightningBolt.set_name)).toHaveTextContent(lightningBolt.set_code.toUpperCase());
    expect(tile).toHaveTextContent(`#${lightningBolt.collector_number}`);
    expect(within(tile).getByText(eur(lightningBolt.prices.eur))).toBeInTheDocument();
    expect(within(tile).getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('prices a foil-only printing at its foil price', () => {
    render(<CardTile card={propaganda} />);
    expect(screen.getByText(eur(propaganda.prices.eur_foil))).toBeInTheDocument();
    expect(screen.queryByTitle('No price available')).not.toBeInTheDocument();
  });

  it('shows a given unit price instead of working one out', () => {
    render(<CardTile card={lightningBolt} unitPrice={9.99} />);
    expect(screen.getByText(eur(9.99))).toBeInTheDocument();
    expect(screen.queryByText(eur(lightningBolt.prices.eur))).not.toBeInTheDocument();
  });
});

describe('CollectionEntryTile', () => {
  it('shows quantity, condition, the server unit price and the line value', () => {
    const { bolts } = entries;
    render(<CollectionEntryTile entry={bolts} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText(`${bolts.quantity}×`)).toBeInTheDocument();
    expect(within(tile).getByTitle('Near Mint')).toHaveTextContent(/^NM$/);
    expect(within(tile).getByText(eur(bolts.unit_price_eur))).toBeInTheDocument();
    expect(within(tile).getByText(/^Value/)).toHaveTextContent(eur(bolts.value_eur));
  });

  it('labels foils and etched foils, but not non-foils', () => {
    const { rerender } = render(<CollectionEntryTile entry={entries.foilRagavan} />);
    expect(screen.getByText('Foil')).toBeInTheDocument();
    rerender(<CollectionEntryTile entry={entries.etchedFireIce} />);
    expect(screen.getByText('Etched foil')).toBeInTheDocument();
    rerender(<CollectionEntryTile entry={entries.bolts} />);
    expect(screen.queryByText(/foil/i)).not.toBeInTheDocument();
  });

  it('shows the language only when it is not English', () => {
    const { rerender } = render(<CollectionEntryTile entry={entries.germanDelver} />);
    expect(screen.getByTitle('German')).toHaveTextContent(/^DE$/);
    rerender(<CollectionEntryTile entry={entries.bolts} />);
    expect(screen.queryByTitle('English')).not.toBeInTheDocument();
  });

  it('shows dashes for the price and value of an unpriced card', () => {
    render(<CollectionEntryTile entry={entries.unpricedElves} />);
    expect(screen.getAllByTitle('No price available')).toHaveLength(2);
  });

  it('renders its actions', () => {
    render(<CollectionEntryTile entry={entries.bolts} actions={<button type="button">Remove</button>} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
