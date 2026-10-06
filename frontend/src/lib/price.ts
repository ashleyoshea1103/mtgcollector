import type { CardSummary, Finish, Prices } from '../types';

export type Currency = 'eur' | 'usd';

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

const formatters: Record<Currency, Intl.NumberFormat> = {
  eur: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }),
  usd: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }),
};

export function formatPrice(value: number, currency: Currency = 'eur'): string {
  return formatters[currency].format(value);
}
