import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards } from '../fixtures';
import { getByTooltip } from '../test/helpers';
import { CardDetail } from './CardDetail';
import { ManaSymbol } from './ManaSymbol';
import { OracleText } from './OracleText';

describe('OracleText', () => {
  it('shows symbols in rules text as images, read out in words', () => {
    const { container } = render(<OracleText text="{T}: Add {G}." />);
    const p = container.querySelector('p')!;
    expect([...p.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'https://svgs.scryfall.io/card-symbols/T.svg',
      'https://svgs.scryfall.io/card-symbols/G.svg',
    ]);
    // Screen readers hear the words in place of the images.
    expect(p).toHaveTextContent(/^tap: Add green\.$/);
    expect(getByTooltip(p, 'tap')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps text without symbols as it is, line breaks included', () => {
    const { container } = render(<OracleText text={'Tap target permanent.\nDraw a card.'} />);
    expect(container.querySelector('p')!.textContent).toBe('Tap target permanent.\nDraw a card.');
    expect(container.querySelector('img')).toBeNull();
  });

  it('is used for rules text in the card detail', () => {
    // Ragavan's rules text includes its dash cost, {1}{R}.
    const { container } = render(<CardDetail card={cards.ragavan} />);
    const oracle = container.querySelector('.card-detail__oracle')!;
    expect([...oracle.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'https://svgs.scryfall.io/card-symbols/1.svg',
      'https://svgs.scryfall.io/card-symbols/R.svg',
    ]);
    expect(oracle).not.toHaveTextContent('{');
  });
});

describe('ManaSymbol', () => {
  it("doesn't tell Scryfall which page loaded it", () => {
    const { container } = render(<ManaSymbol symbol="G" />);
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('can be left to a parent to announce', () => {
    render(<ManaSymbol symbol="G" announce={false} />);
    expect(screen.queryByText('green')).not.toBeInTheDocument();
  });
});
