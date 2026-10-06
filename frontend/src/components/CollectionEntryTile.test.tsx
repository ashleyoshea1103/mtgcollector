import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { entries } from '../fixtures';
import { CardTile } from './CardTile';
import { CollectionEntryTile } from './CollectionEntryTile';
import { cards } from '../fixtures';

describe('CardTile', () => {
  it('shows the name, printing, price and actions', () => {
    render(<CardTile card={cards.lightningBolt} actions={<button type="button">Add</button>} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByRole('heading', { name: 'Lightning Bolt' })).toBeInTheDocument();
    expect(tile).toHaveTextContent('M10');
    expect(tile).toHaveTextContent('#146');
    expect(tile).toHaveTextContent(/1[.,]55/);
    expect(within(tile).getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

describe('CollectionEntryTile', () => {
  it('shows quantity, condition and the line value', () => {
    render(<CollectionEntryTile entry={entries.bolts} />);
    const tile = screen.getByRole('article');
    expect(tile).toHaveTextContent('4×');
    expect(within(tile).getByTitle('Near Mint')).toHaveTextContent('NM');
    expect(tile).toHaveTextContent(/Value\s*€?\s*6[.,]20/);
  });

  it('marks foils and prices them at the foil price', () => {
    render(<CollectionEntryTile entry={entries.foilRagavan} />);
    const tile = screen.getByRole('article');
    expect(tile).toHaveTextContent('Foil');
    expect(tile).toHaveTextContent(/53[.,]92/);
    expect(tile).not.toHaveTextContent(/34[.,]19/);
  });

  it('shows the language only when it is not English', () => {
    const { rerender } = render(<CollectionEntryTile entry={entries.germanDelver} />);
    expect(screen.getByTitle('German')).toHaveTextContent('DE');
    rerender(<CollectionEntryTile entry={entries.bolts} />);
    expect(screen.queryByTitle('English')).not.toBeInTheDocument();
  });

  it('shows a dash for the value of an unpriced card', () => {
    render(<CollectionEntryTile entry={entries.farseek} />);
    expect(screen.getAllByTitle('No price available')).toHaveLength(2); // unit price and value
  });
});
