import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cards, entries, serverPricedBolts } from '../fixtures';
import { cellsByColumn, eur, usd } from '../test/helpers';
import { CardDetail } from './CardDetail';

const { delver, fireIce, lightningBolt, propaganda, ragavan } = cards;
const priceRow = (finish: string) => cellsByColumn(within(screen.getByRole('table')).getByRole('rowheader', { name: finish }).closest('tr')!);

describe('CardDetail', () => {
  it('names the printing: set, number, rarity and release date', () => {
    render(<CardDetail card={ragavan} />);
    const printing = screen.getByRole('heading', { level: 2, name: ragavan.name }).nextElementSibling!;
    expect(printing).toHaveTextContent(`${ragavan.set_name} #${ragavan.collector_number}`);
    expect(within(printing as HTMLElement).getByTitle('Mythic rare')).toHaveTextContent('M');
    expect(within(printing as HTMLElement).getByText(ragavan.released_at)).toHaveAttribute('datetime', ragavan.released_at);
  });

  it('shows both faces of a transforming card, with images, costs and rules text', () => {
    render(<CardDetail card={delver} />);
    expect(screen.getByRole('img', { name: 'Delver of Secrets' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Insectile Aberration' })).toBeInTheDocument();
    const front = screen.getByRole('heading', { level: 3, name: /^Delver of Secrets/ });
    expect(within(front).getByRole('img', { name: delver.faces![0].mana_cost })).toBeInTheDocument();
    expect(screen.getByText('Flying')).toBeInTheDocument();
  });

  it('shows one image but both halves, with their costs, for a split card', () => {
    render(<CardDetail card={fireIce} />);
    expect(screen.getAllByRole('img', { name: fireIce.name })).toHaveLength(1);
    for (const face of fireIce.faces!) {
      const heading = screen.getByRole('heading', { level: 3, name: new RegExp(`^${face.name}`) });
      expect(within(heading).getByRole('img', { name: face.mana_cost })).toBeInTheDocument();
    }
  });

  it('shows both sides of a reversible card whose faces share a name, without React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<CardDetail card={propaganda} />);
    expect(screen.getAllByRole('img', { name: 'Propaganda' })).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 3, name: /^Propaganda/ })).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows the rules text of a single-faced card', () => {
    render(<CardDetail card={lightningBolt} />);
    expect(screen.getByText(lightningBolt.oracle_text!)).toBeInTheDocument();
  });

  it('prices every finish the printing exists in, in EUR and USD', () => {
    render(<CardDetail card={fireIce} />);
    expect(within(screen.getByRole('table')).getAllByRole('rowheader').map((th) => th.textContent)).toEqual([
      'Non-foil',
      'Foil',
      'Etched foil',
    ]);
    const { prices } = fireIce;
    expect(priceRow('Non-foil')['EUR (Cardmarket)']).toHaveTextContent(eur(prices.eur));
    expect(priceRow('Non-foil').USD).toHaveTextContent(usd(prices.usd));
    expect(priceRow('Foil')['EUR (Cardmarket)']).toHaveTextContent(eur(prices.eur_foil));
    expect(priceRow('Foil').USD).toHaveTextContent(usd(prices.usd_foil));
    expect(priceRow('Etched foil')['EUR (Cardmarket)']).toHaveTextContent(eur(prices.eur_foil));
    expect(priceRow('Etched foil').USD).toHaveTextContent(usd(prices.usd_etched));
  });

  it('keeps the etched row when there is no USD etched price', () => {
    render(<CardDetail card={{ ...fireIce, prices: { ...fireIce.prices, usd_etched: null } }} />);
    expect(priceRow('Etched foil').USD).toHaveTextContent(usd(fireIce.prices.usd_foil));
  });

  it('only prices the foil finish of a foil-only printing', () => {
    render(<CardDetail card={propaganda} />);
    expect(within(screen.getByRole('table')).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['Foil']);
    expect(priceRow('Foil')['EUR (Cardmarket)']).toHaveTextContent(eur(propaganda.prices.eur_foil));
  });

  it('links to Cardmarket in a new tab without leaking the opener or referrer', () => {
    render(<CardDetail card={ragavan} />);
    const link = screen.getByRole('link', { name: 'View on Cardmarket' });
    expect(link).toHaveAttribute('href', ragavan.cardmarket_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });

  it('has no Cardmarket link when Scryfall has none', () => {
    render(<CardDetail card={{ ...ragavan, cardmarket_url: null }} />);
    expect(screen.queryByRole('link', { name: 'View on Cardmarket' })).not.toBeInTheDocument();
  });

  it('lists the copies the user owns with their value', () => {
    const { germanDelver } = entries;
    render(<CardDetail card={delver} entries={[germanDelver]} />);
    expect(screen.getByRole('heading', { name: 'In your collection' })).toBeInTheDocument();
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent(`${germanDelver.quantity}× Non-foil, Excellent, German`);
    expect(item).toHaveTextContent(eur(germanDelver.value_eur));
  });

  it("shows the server's value for owned copies", () => {
    render(<CardDetail card={lightningBolt} entries={[serverPricedBolts]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent(eur(serverPricedBolts.value_eur));
  });

  it('omits the owned section when the user has no copies', () => {
    render(<CardDetail card={delver} />);
    expect(screen.queryByRole('heading', { name: 'In your collection' })).not.toBeInTheDocument();
  });
});
