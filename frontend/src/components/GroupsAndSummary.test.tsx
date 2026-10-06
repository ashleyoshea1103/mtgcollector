import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, customGroups, stats } from '../fixtures';
import { CollectionSummary } from './CollectionSummary';
import { CustomGroupCard } from './CustomGroupCard';
import { ManaCost } from './ManaCost';
import { PrintingOption } from './PrintingOption';

describe('CustomGroupCard', () => {
  it('shows the group name, kind, count, value and up to four previews', () => {
    const deck = customGroups.find((g) => g.kind === 'deck')!;
    const { container } = render(<CustomGroupCard group={deck} />);
    expect(screen.getByRole('heading', { name: 'Izzet Tempo' })).toBeInTheDocument();
    expect(screen.getByText('Deck')).toBeInTheDocument();
    expect(screen.getByText('8 cards')).toBeInTheDocument();
    expect(container.querySelectorAll('.custom-group-card__previews img')).toHaveLength(4);
  });

  it('says when a group is empty', () => {
    render(<CustomGroupCard group={customGroups.find((g) => g.card_count === 0)!} />);
    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(screen.getByText('0 cards')).toBeInTheDocument();
  });
});

describe('CollectionSummary', () => {
  it('shows totals and the color and rarity breakdowns', () => {
    render(<CollectionSummary stats={stats} />);
    const cardsTotal = screen.getByText('Cards').closest('div')!;
    expect(cardsTotal).toHaveTextContent(String(stats.total_cards));
    expect(screen.getByText('Value (Cardmarket)').closest('div')).toHaveTextContent(/62[.,]57/);

    const byColor = screen.getByRole('heading', { name: 'By color' }).closest('section')!;
    expect(within(byColor).getByText('Red').parentElement).toHaveTextContent('Red 5');
    const byRarity = screen.getByRole('heading', { name: 'By rarity' }).closest('section')!;
    expect(within(byRarity).getByText('Mythic rare').parentElement).toHaveTextContent('Mythic rare 1');
  });
});

describe('PrintingOption', () => {
  it('reports the printing when picked and shows it as pressed when selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<PrintingOption card={cards.ragavan} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: /Modern Horizons 2/ });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(cards.ragavan);

    rerender(<PrintingOption card={cards.ragavan} selected onSelect={onSelect} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ManaCost', () => {
  it('renders one symbol per pip and separates split-card halves', () => {
    const { container } = render(<ManaCost cost="{1}{R} // {1}{U}" />);
    expect(container.querySelectorAll('.mana-symbol')).toHaveLength(4);
    expect(container.querySelector('.mana-cost__separator')).toHaveTextContent('//');
  });

  it('renders nothing for an empty cost', () => {
    const { container } = render(<ManaCost cost="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
