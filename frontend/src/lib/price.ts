import type { CardSummary, Finish, Prices } from '../types';

/** The currencies a card has prices in (Scryfall's, from Cardmarket and TCGplayer). */
export type Currency = 'eur' | 'usd';
/** The currencies a price can be shown in: pounds are euros converted (toPounds). */
export type ShownCurrency = Currency | 'gbp';

/**
 * The unit price of one copy in a finish, for cards that aren't owned yet
 * (search results, printing picker). Owned entries carry the server's
 * `unit_price_eur` instead. The server applies the same rule:
 * - non-foil: the regular price
 * - foil: the foil price, else the regular price
 * - etched: the etched price (USD only; Scryfall has no EUR etched price), else foil, else regular
 */
export function priceFor(prices: Prices, finish: Finish = 'nonfoil', currency: Currency = 'eur'): number | null {
  const regular = prices[currency];
  if (finish === 'nonfoil') return regular;
  const foil = prices[`${currency}_foil`] ?? regular;
  if (finish === 'foil') return foil;
  return (currency === 'usd' ? prices.usd_etched : null) ?? foil;
}

/** The finish to price a printing at when none is chosen: non-foil if it exists, else its first finish (e.g. foil-only promos). */
export function defaultFinish(card: Pick<CardSummary, 'finishes'>): Finish {
  return card.finishes.includes('nonfoil') ? 'nonfoil' : (card.finishes[0] ?? 'nonfoil');
}

/** Rounds a EUR/USD amount to cents, half up (1.005 → 1.01), as Postgres numeric does. */
export function roundToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** quantity × unit price, in cents; null when there's no unit price. */
export function lineValue(unitPrice: number | null, quantity: number): number | null {
  return unitPrice == null ? null : roundToCents(unitPrice * quantity);
}

/** A euro amount in pounds at gbpPerEur pounds to the euro, to the penny (half up, as euros are rounded). */
export function toPounds(eur: number, gbpPerEur: number): number {
  return roundToCents(eur * gbpPerEur);
}

const formatters: Record<ShownCurrency, Intl.NumberFormat> = {
  eur: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }),
  usd: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }),
  gbp: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }),
};

export function formatPrice(value: number, currency: ShownCurrency = 'eur'): string {
  return formatters[currency].format(value);
}
