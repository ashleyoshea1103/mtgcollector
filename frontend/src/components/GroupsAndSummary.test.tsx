import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, customGroups, stats, unpricedCard } from '../fixtures';
import { COLORS, RARITIES } from '../lib/labels';
import { eur } from '../test/helpers';
import type { CardSummary, CustomGroup } from '../types';
import { CollectionSummary } from './CollectionSummary';
import { CustomGroupCard } from './CustomGroupCard';
import { ManaCost } from './ManaCost';
import { PrintingOption } from './PrintingOption';
import { RarityBadge } from './RarityBadge';
import { SetSymbol } from './SetSymbol';

const group = (name: string) => customGroups.find((g) => g.name === name)!;

describe('CustomGroupCard', () => {
  it('shows the name, kind, count, value, description and actions', () => {
    const binder = group('Trade binder');
    render(<CustomGroupCard group={binder} actions={<button type="button">Open</button>} />);
    expect(screen.getByRole('heading', { name: binder.name })).toBeInTheDocument();
    expect(screen.getByText('Binder')).toBeInTheDocument();
    expect(screen.getByText(`${binder.card_count} cards`)).toBeInTheDocument();
    expect(screen.getByText(binder.description)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('shows a partly priced total with the number of unpriced cards', () => {
    const binder = group('Trade binder');
    expect(binder.unpriced_count).toBeGreaterThan(0);
    const { container } = render(<CustomGroupCard group={binder} />);
    expect(container.querySelector('.total-value')).toHaveTextContent(`${eur(binder.value_eur)} (+${binder.unpriced_count} unpriced)`);
  });

  it('shows at most four previews', () => {
    const deck = group('Izzet Tempo');
    expect(deck.preview_images.length).toBeGreaterThan(4);
    const { container } = render(<CustomGroupCard group={deck} />);
    const imgs = [...container.querySelectorAll('.custom-group-card__previews img')];
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual(deck.preview_images.slice(0, 4));
  });

  it('shows repeated preview images without React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const src = cards.lightningBolt.images!.small;
    const { container } = render(<CustomGroupCard group={{ ...group('Trade binder'), preview_images: [src, src, src] }} />);
    expect(container.querySelectorAll('.custom-group-card__previews img')).toHaveLength(3);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('counts with the right plural and says when a group is empty', () => {
    const one: CustomGroup = { ...group('Bulk box'), card_count: 1, value_eur: 1, preview_images: [] };
    const { rerender } = render(<CustomGroupCard group={one} />);
    expect(screen.getByText('1 card')).toBeInTheDocument();
    rerender(<CustomGroupCard group={group('Bulk box')} />);
    expect(screen.getByText('No cards yet')).toBeInTheDocument();
    expect(screen.getByText('0 cards')).toBeInTheDocument();
  });
});

describe('CollectionSummary', () => {
  const total = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling!;

  it('shows each total in its own place', () => {
    render(<CollectionSummary stats={stats} />);
    expect(total('Cards')).toHaveTextContent(new RegExp(`^${stats.card_count}$`));
    expect(total('Unique')).toHaveTextContent(new RegExp(`^${stats.unique_cards}$`));
    expect(total('Value (Cardmarket)')).toHaveTextContent(eur(stats.value_eur));
    expect(total('Value (Cardmarket)')).toHaveTextContent(`+${stats.unpriced_count} unpriced`);
    expect(screen.queryByText('Value (USD)')).not.toBeInTheDocument();
  });

  it.each([
    ['By color', stats.by_color, COLORS],
    ['By rarity', stats.by_rarity, RARITIES],
  ] as const)('breaks the collection down %s', (title, counts, labels) => {
    render(<CollectionSummary stats={stats} />);
    const section = screen.getByRole('heading', { name: title }).closest('section')!;
    const rows = within(section)
      .getAllByRole('listitem')
      .map((li) => [li.querySelector('.breakdown-item__label')!.textContent, li.querySelector('.breakdown-item__count')!.textContent]);
    expect(rows).toEqual(Object.entries(counts).map(([key, n]) => [(labels as Record<string, string>)[key], String(n)]));
  });
});

describe('PrintingOption', () => {
  it('shows the set, number, release year and price', () => {
    const { ragavan } = cards;
    render(<PrintingOption card={ragavan} />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent(`${ragavan.set.name}#${ragavan.collector_number}${ragavan.released_at.slice(0, 4)}`);
    expect(within(button).getByText(eur(ragavan.prices.eur))).toBeInTheDocument();
  });

  it('prices a foil-only printing at its foil price', () => {
    render(<PrintingOption card={cards.propaganda} />);
    expect(screen.getByText(eur(cards.propaganda.prices.eur_foil))).toBeInTheDocument();
  });

  it('reports the printing when picked and shows it as pressed when selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(card: CardSummary) => void>();
    const { rerender } = render(<PrintingOption card={cards.ragavan} onSelect={onSelect} />);
    const button = screen.getByRole('button', { name: new RegExp(cards.ragavan.set.name) });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(cards.ragavan);

    rerender(<PrintingOption card={cards.ragavan} selected onSelect={onSelect} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ManaCost', () => {
  it('is announced as one image, with the cost in words', () => {
    render(<ManaCost cost="{2}{R}" />);
    expect(screen.getByRole('img', { name: '2 generic, red' })).toBeInTheDocument();
  });

  it('renders one symbol per pip, with a slash-free class, and separates split-card halves', () => {
    const { container } = render(<ManaCost cost="{W/U/P}{2} // {1}{U}" />);
    const symbols = [...container.querySelectorAll('.mana-symbol')];
    expect(symbols.map((el) => [el.textContent, el.getAttribute('title'), el.className])).toEqual([
      ['W/U/P', '{W/U/P}', 'mana-symbol mana-symbol--wup'],
      ['2', '{2}', 'mana-symbol mana-symbol--2'],
      ['1', '{1}', 'mana-symbol mana-symbol--1'],
      ['U', '{U}', 'mana-symbol mana-symbol--u'],
    ]);
    expect(container.querySelector('.mana-cost__separator')!.textContent).toBe(' // ');
  });

  it('renders nothing for an empty cost', () => {
    const { container } = render(<ManaCost cost="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RarityBadge and SetSymbol', () => {
  it.each(Object.entries(RARITIES))('abbreviates %s with its full name as the title', (rarity, label) => {
    render(<RarityBadge rarity={rarity as keyof typeof RARITIES} />);
    expect(screen.getByTitle(label)).toHaveTextContent(new RegExp(`^${rarity[0].toUpperCase()}$`));
  });

  it('shows the set code in capitals, titled with the set name and classed by rarity', () => {
    render(<SetSymbol card={unpricedCard} />);
    const symbol = screen.getByTitle(unpricedCard.set.name);
    expect(symbol).toHaveTextContent(new RegExp(`^${unpricedCard.set.code.toUpperCase()}$`));
    expect(symbol).toHaveClass(`set-symbol--${unpricedCard.rarity}`);
  });

  it("shows the set's symbol as a decorative image, beside the code that names it", () => {
    const { container } = render(<SetSymbol card={cards.ragavan} />);
    const icon = container.querySelector('img');
    expect(icon).toHaveAttribute('src', cards.ragavan.set.icon_svg_uri);
    // The code and the title already say which set it is, so screen readers skip the image.
    expect(icon).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows just the code when the set has no symbol', () => {
    const card = { ...cards.ragavan, set: { ...cards.ragavan.set, icon_svg_uri: null } };
    const { container } = render(<SetSymbol card={card} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTitle(card.set.name)).toHaveTextContent('MH2');
  });
});
