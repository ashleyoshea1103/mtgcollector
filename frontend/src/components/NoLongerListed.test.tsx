import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, unlistedCard } from '../fixtures';
import { CardDetail } from './CardDetail';
import { CardTile } from './CardTile';
import { NoLongerListed } from './NoLongerListed';
import { PrintingOption } from './PrintingOption';

describe('NoLongerListed', () => {
  it('says so for a printing Scryfall no longer lists, and nothing otherwise', () => {
    const { container, rerender } = render(<NoLongerListed card={unlistedCard} />);
    expect(screen.getByText('No longer listed')).toHaveClass('badge', 'badge--warning');
    rerender(<NoLongerListed card={cards.ragavan} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['CardTile', () => render(<CardTile card={unlistedCard} />)],
    ['PrintingOption', () => render(<PrintingOption card={unlistedCard} />)],
    ['CardDetail', () => render(<CardDetail card={unlistedCard} />)],
  ])('is shown by %s', (_, show) => {
    show();
    expect(screen.getByText('No longer listed')).toBeInTheDocument();
  });

  it('is part of the printing picker’s name, so screen readers hear it', () => {
    render(<PrintingOption card={unlistedCard} />);
    expect(within(document.body).getByRole('button', { name: /No longer listed/ })).toBeInTheDocument();
  });

  it.each([
    ['CardTile', () => render(<CardTile card={cards.ragavan} />)],
    ['PrintingOption', () => render(<PrintingOption card={cards.ragavan} />)],
    ['CardDetail', () => render(<CardDetail card={cards.ragavan} />)],
  ])('isn’t shown by %s for a listed printing', (_, show) => {
    show();
    expect(screen.queryByText('No longer listed')).not.toBeInTheDocument();
  });
});
