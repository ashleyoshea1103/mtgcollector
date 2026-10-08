import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, entries, serverPricedBolts } from '../fixtures';
import { eur, getAllByTooltip, getByTooltip, queryByTooltip } from '../test/helpers';
import { corsIconUrl } from '../lib/urls';
import { CardTile } from './CardTile';
import { CollectionEntryTile } from './CollectionEntryTile';

const { lightningBolt, propaganda } = cards;

describe('CardTile', () => {
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

  it('shows a dash for a null given price rather than working one out', () => {
    render(<CardTile card={lightningBolt} unitPrice={null} />);
    expect(getByTooltip(document.body, 'No price available')).toBeInTheDocument();
    expect(screen.queryByText(eur(lightningBolt.prices.eur))).not.toBeInTheDocument();
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
    expect(getByTooltip(tile, 'Near Mint')).toHaveTextContent(/^NM$/);
    expect(within(tile).getByText(eur(bolts.unit_price_eur))).toBeInTheDocument();
    expect(within(tile).getByText(/^Value/)).toHaveTextContent(eur(bolts.value_eur));
  });

  it("shows the server's unit price and value, not one worked out from the card", () => {
    render(<CollectionEntryTile entry={serverPricedBolts} />);
    const tile = screen.getByRole('article');
    expect(within(tile).getByText(eur(serverPricedBolts.unit_price_eur))).toBeInTheDocument();
    expect(within(tile).getByText(/^Value/)).toHaveTextContent(eur(serverPricedBolts.value_eur));
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
