import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cards, unpricedCard } from '../fixtures';
import type { ReactNode } from 'react';
import { MoneyContext, type Money } from '../lib/money';
import { eur, getByTooltip, pounds, usd } from '../test/helpers';
import { Price } from './Price';
import { TotalValue } from './TotalValue';

const { ragavan, fireIce } = cards;

describe('Price', () => {
  it('shows the non-foil Cardmarket price by default, with the raw amount as its value', () => {
    render(<Price prices={ragavan.prices} />);
    const price = screen.getByText(eur(ragavan.prices.eur));
    expect(price.tagName).toBe('DATA');
    expect(price).toHaveAttribute('value', String(ragavan.prices.eur));
  });

  it('shows the foil price for a foil', () => {
    render(<Price prices={ragavan.prices} finish="foil" />);
    expect(screen.getByText(eur(ragavan.prices.eur_foil))).toBeInTheDocument();
  });

  it('shows USD prices when asked, including the etched price', () => {
    render(
      <>
        <Price prices={ragavan.prices} currency="usd" />
        <Price prices={fireIce.prices} finish="etched" currency="usd" />
      </>,
    );
    expect(screen.getByText(usd(ragavan.prices.usd))).toBeInTheDocument();
    expect(screen.getByText(usd(fireIce.prices.usd_etched))).toBeInTheDocument();
  });

  it('shows a dash when the card has no price', () => {
    render(<Price prices={unpricedCard.prices} />);
    expect(getByTooltip(document.body, 'No price available')).toHaveTextContent(/^—$/);
  });

  it('shows a precomputed value, zero as an amount, and null as a dash', () => {
    const { rerender } = render(<Price value={60.12} />);
    expect(screen.getByText(eur(60.12))).toBeInTheDocument();
    rerender(<Price value={0} />);
    expect(screen.getByText(eur(0))).toBeInTheDocument();
    rerender(<Price value={null} />);
    expect(getByTooltip(document.body, 'No price available')).toBeInTheDocument();
  });
});

const inPounds: Money = { chosen: 'gbp', currency: 'gbp', gbpPerEur: 0.8712, rateDate: '2026-10-09', choose: () => {} };
const showing = (money: Money) => ({ wrapper: ({ children }: { children: ReactNode }) => <MoneyContext value={money}>{children}</MoneyContext> });

describe('Price, in pounds', () => {
  it('shows a euro amount converted, marked approximate, and read out as "about"', () => {
    const { container } = render(<Price value={2.06} />, showing(inPounds));
    const price = container.querySelector('data')!;
    expect(price).toHaveTextContent(pounds(2.06));
    expect(price).toHaveClass('price--gbp');
    expect(price).toHaveAttribute('value', '1.79');
    expect(screen.getByText('≈')).toHaveAttribute('aria-hidden', 'true');
  });

  it("still shows a dash for a card that has no price, not a pound amount", () => {
    render(<Price value={null} />, showing(inPounds));
    expect(getByTooltip(document.body, 'No price available')).toHaveTextContent('—');
    expect(document.body).not.toHaveTextContent('£');
  });

  it('leaves dollar prices in dollars', () => {
    const { container } = render(<Price prices={ragavan.prices} currency="usd" />, showing(inPounds));
    expect(container).toHaveTextContent(usd(ragavan.prices.usd));
    expect(container).not.toHaveTextContent('≈');
  });

  it('shows euros when euros are in effect', () => {
    const { container } = render(<Price value={2.06} />, showing({ ...inPounds, chosen: 'gbp', currency: 'eur' }));
    expect(container).toHaveTextContent(eur(2.06));
    expect(container).not.toHaveTextContent('≈');
  });

  it("converts a partly priced total, keeping the count of cards it couldn't price", () => {
    const { container } = render(<TotalValue total={{ card_count: 5, value_eur: 12.5, unpriced_count: 2 }} />, showing(inPounds));
    expect(container).toHaveTextContent(`${pounds(12.5)} (+2 unpriced)`);
  });
});

describe('TotalValue', () => {
  it('shows the total when every card is priced', () => {
    const { container } = render(<TotalValue total={{ card_count: 3, value_eur: 12.5, unpriced_count: 0 }} />);
    expect(container).toHaveTextContent(new RegExp(`^${escape(eur(12.5))}$`));
  });

  it('says how many cards were left out of a partly priced total', () => {
    const { container } = render(<TotalValue total={{ card_count: 5, value_eur: 12.5, unpriced_count: 2 }} />);
    expect(container).toHaveTextContent(`${eur(12.5)} (+2 unpriced)`);
    expect(container.firstElementChild).toHaveClass('total-value--partial');
  });

  it('shows a dash, not a zero total, when no card has a price', () => {
    const { container } = render(<TotalValue total={{ card_count: 3, value_eur: 0, unpriced_count: 3 }} />);
    expect(getByTooltip(container, 'No price available')).toHaveTextContent(/^—$/);
    expect(container).not.toHaveTextContent(/d/);
  });

  it('shows a dash for inconsistent totals that claim unpriced cards but no cards', () => {
    const { container } = render(<TotalValue total={{ card_count: 0, value_eur: 0, unpriced_count: 2 }} />);
    expect(getByTooltip(container, 'No price available')).toHaveTextContent(/^—$/);
    expect(container).not.toHaveTextContent(/d/);
  });

  it('shows zero for an empty group', () => {
    const { container } = render(<TotalValue total={{ card_count: 0, value_eur: 0, unpriced_count: 0 }} />);
    expect(container).toHaveTextContent(eur(0));
  });
});

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
