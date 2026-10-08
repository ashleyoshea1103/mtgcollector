import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, customGroups, stats, unpricedCard } from '../fixtures';
import { COLORS, RARITIES } from '../lib/labels';
import { eur, getByTooltip } from '../test/helpers';
import { corsIconUrl } from '../lib/urls';
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
    expect(getByTooltip(button, ragavan.set.name)).toHaveClass('set-symbol');
  });

  it('is named by the set once: the symbol beside the name is skipped', () => {
    render(<PrintingOption card={cards.ragavan} />);
    expect(screen.getByRole('button', { name: new RegExp(`^${cards.ragavan.set.name}`) })).toBeInTheDocument();
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

    // Picking the selected one again reports it again (and it stays selected).
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ManaCost', () => {
  it('is announced as one image, with the cost in words', () => {
    render(<ManaCost cost="{2}{R}" />);
    expect(screen.getByRole('img', { name: '2 generic, red' })).toBeInTheDocument();
  });

  it("shows each pip as Scryfall's image, named on hover, and separates split-card halves", () => {
    const { container } = render(<ManaCost cost="{W/U/P}{2} // {1}{U}" />);
    const symbols = [...container.querySelectorAll<HTMLElement>('.mana-symbol')];
    const file = (el: HTMLElement) => el.querySelector('img')?.getAttribute('src')?.replace('https://svgs.scryfall.io/card-symbols/', '');
    expect(symbols.map((el) => [file(el), el.textContent, el.dataset.tooltip, el.className])).toEqual([
      ['WUP.svg', '', 'one white mana, one blue mana, or 2 life', 'mana-symbol mana-symbol--wup'],
      ['2.svg', '', 'two generic mana', 'mana-symbol mana-symbol--2'],
      ['1.svg', '', 'one generic mana', 'mana-symbol mana-symbol--1'],
      ['U.svg', '', 'one blue mana', 'mana-symbol mana-symbol--u'],
    ]);
    // Screen readers skip the images and read the cost as a whole.
    for (const img of container.querySelectorAll('img')) expect(img).toHaveAttribute('alt', '');
    for (const symbol of symbols) expect(symbol).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.mana-cost__separator')!.textContent).toBe(' // ');
  });

  it('shows a symbol whose image fails to load as text instead', () => {
    const { container } = render(<ManaCost cost="{G}{U}" />);
    fireEvent.error(container.querySelector('img')!);
    const [green, blue] = container.querySelectorAll<HTMLElement>('.mana-symbol');
    expect(green.querySelector('img')).toBeNull();
    expect(green).toHaveTextContent(/^G$/);
    expect(green).toHaveClass('mana-symbol--text');
    expect(blue.querySelector('img')).not.toBeNull(); // only the one that failed
  });

  it("shows a symbol Scryfall has no image for as text, in braces", () => {
    const { container } = render(<ManaCost cost="{G}{NEW}" />);
    const [known, unknown] = container.querySelectorAll<HTMLElement>('.mana-symbol');
    expect(known.querySelector('img')).toHaveAttribute('src', 'https://svgs.scryfall.io/card-symbols/G.svg');
    expect(unknown.querySelector('img')).toBeNull();
    expect(unknown).toHaveTextContent(/^NEW$/);
    expect(unknown).toHaveClass('mana-symbol--text');
    expect(screen.getByRole('img', { name: 'green, NEW' })).toBeInTheDocument();
  });

  it('renders nothing for an empty cost', () => {
    const { container } = render(<ManaCost cost="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RarityBadge and SetSymbol', () => {
  it.each(Object.entries(RARITIES))('abbreviates %s with its full name as the title', (rarity, label) => {
    render(<RarityBadge rarity={rarity as keyof typeof RARITIES} />);
    expect(getByTooltip(document.body, label)).toHaveTextContent(new RegExp(`^${rarity[0].toUpperCase()}$`));
  });

  it('shows the set symbol instead of the code, with the set name on hover, classed by rarity', () => {
    render(<SetSymbol set={unpricedCard.set} rarity={unpricedCard.rarity} />);
    const symbol = getByTooltip(document.body, unpricedCard.set.name);
    expect(symbol.querySelector('img')).toHaveAttribute('src', corsIconUrl(unpricedCard.set.icon_svg_uri!));
    expect(symbol).toHaveTextContent(/^$/);
    expect(symbol).toHaveClass(`set-symbol--${unpricedCard.rarity}`);
  });

  it('has no rarity class when no rarity is given', () => {
    render(<SetSymbol set={cards.ragavan.set} />);
    expect(getByTooltip(document.body, cards.ragavan.set.name)).toHaveAttribute('class', 'set-symbol');
  });

  it("draws the set's symbol in the rarity's colour, as a mask of Scryfall's SVG", () => {
    const { container } = render(<SetSymbol set={cards.ragavan.set} rarity="mythic" />);
    const icon = container.querySelector<HTMLElement>('.set-symbol__icon')!;
    // Its own URL for the CORS fetch, so a copy cached by a plain <img> can't break it.
    expect(icon.style.getPropertyValue('--set-icon')).toBe(`url("${corsIconUrl(cards.ragavan.set.icon_svg_uri!)}")`);
    // The colour comes from the rarity class on the symbol (CSS: currentColor).
    expect(icon.closest('.set-symbol')).toHaveClass('set-symbol--mythic');
    expect(container.querySelector('.set-symbol__code')).toBeNull();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the code instead when the symbol fails to load', () => {
    const { container } = render(<SetSymbol set={cards.ragavan.set} rarity="mythic" />);
    // A hidden probe image of the same URL reports the failure the mask can't.
    const probe = container.querySelector('img.set-symbol__probe')!;
    expect(probe).toHaveAttribute('src', corsIconUrl(cards.ragavan.set.icon_svg_uri!));
    expect(probe).toHaveAttribute('crossorigin', 'anonymous'); // fetched as the mask is, so once
    // Hidden, a lazy image would never load, so a failure would go unseen.
    expect(probe).not.toHaveAttribute('loading');
    fireEvent.error(probe);
    expect(container.querySelector('.set-symbol__icon')).toBeNull();
    expect(container.querySelector('.set-symbol__code')).toHaveTextContent(/^MH2$/);
  });

  it("gives another set's symbol its own try after one failed", () => {
    const { container, rerender } = render(<SetSymbol set={cards.ragavan.set} />);
    fireEvent.error(container.querySelector('img.set-symbol__probe')!);
    rerender(<SetSymbol set={cards.lightningBolt.set} />);
    expect(container.querySelector('.set-symbol__icon')).not.toBeNull();
    expect(container.querySelector('.set-symbol__code')).toBeNull();
  });

  it("takes the symbol's own proportions once it has loaded", () => {
    const { container, rerender } = render(<SetSymbol set={cards.ragavan.set} />);
    const icon = () => container.querySelector<HTMLElement>('.set-symbol__icon')!;
    expect(icon().style.getPropertyValue('--set-icon-ratio')).toBe(''); // CSS default until then
    const probe = container.querySelector<HTMLImageElement>('img.set-symbol__probe')!;
    Object.defineProperties(probe, { naturalWidth: { value: 232 }, naturalHeight: { value: 150 } });
    fireEvent.load(probe);
    expect(Number(icon().style.getPropertyValue('--set-icon-ratio'))).toBeCloseTo(232 / 150);
    // A different set doesn't keep the old proportions.
    rerender(<SetSymbol set={cards.lightningBolt.set} />);
    expect(icon().style.getPropertyValue('--set-icon-ratio')).toBe('');
  });

  it("doesn't tell Scryfall which page loaded the symbol", () => {
    const { container } = render(<SetSymbol set={cards.ragavan.set} rarity={cards.ragavan.rarity} />);
    expect(container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it.each(['https://evil.example/mh2.svg', 'data:image/svg+xml,<svg onload="alert(1)"/>'])(
    "won't load a symbol from anywhere but Scryfall's icon host (%s)",
    (url) => {
      const card = { ...cards.ragavan, set: { ...cards.ragavan.set, icon_svg_uri: url } };
      const { container } = render(<SetSymbol set={card.set} rarity={card.rarity} />);
      expect(container.querySelector('img')).toBeNull();
      expect(getByTooltip(document.body, card.set.name)).toHaveTextContent('MH2');
    },
  );

  it("is read as the set's name, or skipped when the name is shown beside it", () => {
    const { rerender } = render(<SetSymbol set={cards.ragavan.set} rarity={cards.ragavan.rarity} />);
    expect(getByTooltip(document.body, cards.ragavan.set.name)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(cards.ragavan.set.name)).toHaveClass('visually-hidden');
    rerender(<SetSymbol set={cards.ragavan.set} rarity={cards.ragavan.rarity} nameShown />);
    expect(getByTooltip(document.body, cards.ragavan.set.name)).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText(cards.ragavan.set.name)).not.toBeInTheDocument();
  });

  it('shows just the code when the set has no symbol', () => {
    const card = { ...cards.ragavan, set: { ...cards.ragavan.set, icon_svg_uri: null } };
    const { container } = render(<SetSymbol set={card.set} rarity={card.rarity} />);
    expect(container.querySelector('img')).toBeNull();
    expect(getByTooltip(document.body, card.set.name)).toHaveTextContent('MH2');
  });
});
