import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards } from '../fixtures';
import { Price } from './Price';

describe('Price', () => {
  it('shows the non-foil Cardmarket price by default', () => {
    render(<Price prices={cards.ragavan.prices} />);
    expect(screen.getByText(/34[.,]19/)).toBeInTheDocument();
  });

  it('shows the foil price for a foil', () => {
    render(<Price prices={cards.ragavan.prices} finish="foil" />);
    expect(screen.getByText(/53[.,]92/)).toBeInTheDocument();
  });

  it('shows a dash when the card has no price', () => {
    render(<Price prices={cards.noPrice.prices} />);
    expect(screen.getByTitle('No price available')).toHaveTextContent('—');
  });

  it('shows a precomputed value, or a dash for null', () => {
    const { rerender } = render(<Price value={60.12} />);
    expect(screen.getByText(/60[.,]12/)).toBeInTheDocument();
    rerender(<Price value={null} />);
    expect(screen.getByTitle('No price available')).toBeInTheDocument();
  });
});
