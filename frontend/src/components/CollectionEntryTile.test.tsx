import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cards, entries, serverPricedBolts } from '../fixtures';
import { eur, getAllByTooltip, getByTooltip, queryByTooltip } from '../test/helpers';
import { corsIconUrl } from '../lib/urls';
import { CardTile } from './CardTile';
import { CollectionEntryTile } from './CollectionEntryTile';

const { lightningBolt, propaganda } = cards;

describe('CardTile', () => {
  it('opens the larger view from its image when it offers one', async () => {
    const onView = vi.fn<() => void>();
    const name = `View ${lightningBolt.name} larger`;
    const { rerender } = render(<CardTile card={lightningBolt} />);
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    rerender(<CardTile card={lightningBolt} onView={onView} />);
    const view = screen.getByRole('button', { name });
    expect(view.querySelector('img')).toHaveAttribute('src', lightningBolt.images!.normal);
    await userEvent.click(view);
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('can bring its own price line, or none', () => {
    const { rerender } = render(<CardTile card={lightningBolt} price={<p>Priced elsewhere</p>} />);
    expect(screen.getByText('Priced elsewhere')).toBeInTheDocument();
    expect(screen.queryByText(eur(lightningBolt.prices.eur))).not.toBeInTheDocument();
    rerender(<CardTile card={lightningBolt} price={null} />);
    expect(document.querySelector('.card-tile__price')).toBeNull();
    expect(screen.queryByText(eur(lightningBolt.prices.eur))).not.toBeInTheDocument();
  });

  it('marks its finish, so foil and etched copies shimmer', () => {
    const { rerender } = render(<CardTile card={lightningBolt} finish="foil" />);
    expect(screen.getByRole('article')).toHaveClass('card-tile--foil');
    rerender(<CardTile card={lightningBolt} finish="etched" />);
    expect(screen.getByRole('article')).toHaveClass('card-tile--etched');
    rerender(<CardTile card={lightningBolt} />);
    expect(screen.getByRole('article')).toHaveClass('card-tile--nonfoil');
  });

  it('shows the name, printing, non-foil price and actions', () => {
    render(<CardTile card={lightningBolt} actions={<button type="button">Add</button>} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByRole('heading', { name: lightningBolt.name })).toBeInTheDocument();
    expect(getByTooltip(tile, lightningBolt.set.name).querySelector('img')).toHaveAttribute('src', corsIconUrl(lightningBolt.set.icon_svg_uri!));
    // The set's name is shown, not only given as the symbol's title.
    expect(within(tile).getByText(lightningBolt.set.name)).toBeVisible();
    expect(tile).toHaveTextContent(`#${lightningBolt.collector_number}`);
    expect(within(tile).getByText(eur(lightningBolt.prices.eur))).toBeInTheDocument();
    expect(within(tile).getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('prices a foil-only printing at its foil price', () => {
    render(<CardTile card={propaganda} />);
    expect(screen.getByText(eur(propaganda.prices.eur_foil))).toBeInTheDocument();
    expect(queryByTooltip(document.body, 'No price available')).not.toBeInTheDocument();
  });

});

describe('CollectionEntryTile', () => {
  it("shows its price once, as the unit price beside the line's value", () => {
    render(<CollectionEntryTile entry={entries.bolts} />);
    const tile = screen.getByRole('article');
    expect(tile.querySelectorAll('.card-tile__price')).toHaveLength(0);
    expect(tile.querySelector('.entry-tile__price')).toHaveTextContent(`${eur(entries.bolts.unit_price_eur)} each`);
    expect(tile.querySelector('.entry-tile__price')).toHaveTextContent(`Value ${eur(entries.bolts.value_eur)}`);
  });

  it('shows quantity, condition, the server unit price and the line value', () => {
    const { bolts } = entries;
    render(<CollectionEntryTile entry={bolts} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText(`${bolts.quantity}×`)).toBeInTheDocument();
    expect(getByTooltip(tile, 'Near Mint')).toHaveTextContent(/^NM$/);
    expect(within(tile).getByText(eur(bolts.unit_price_eur))).toBeInTheDocument();
    expect(tile.querySelector('.entry-tile__value')).toHaveTextContent(`Value ${eur(bolts.value_eur)}`);
    expect(tile.querySelector('.entry-tile__unit')).toHaveTextContent(`${eur(bolts.unit_price_eur)} each`);
  });

  it("shows the server's unit price and value, not one worked out from the card", () => {
    render(<CollectionEntryTile entry={serverPricedBolts} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText(eur(serverPricedBolts.unit_price_eur))).toBeInTheDocument();
    expect(tile.querySelector('.entry-tile__value')).toHaveTextContent(`Value ${eur(serverPricedBolts.value_eur)}`);
    expect(tile).not.toHaveTextContent(eur(lightningBolt.prices.eur));
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
    expect(getByTooltip(document.body, 'German')).toHaveTextContent(/^DE$/);
    rerender(<CollectionEntryTile entry={entries.bolts} />);
    expect(queryByTooltip(document.body, 'English')).not.toBeInTheDocument();
  });

  it('shows dashes for the price and value of an unpriced card', () => {
    render(<CollectionEntryTile entry={entries.unpricedElves} />);
    expect(getAllByTooltip(document.body, 'No price available')).toHaveLength(2);
  });

  it('renders its actions', () => {
    render(<CollectionEntryTile entry={entries.bolts} actions={<button type="button">Remove</button>} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
