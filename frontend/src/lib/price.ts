import type { Finish, Prices } from '../types';

export type Currency = 'eur' | 'usd';

/**
 * The unit price for a finish. Foil and etched use the foil price, falling
 * back to the non-foil price when no foil price is listed.
 */
export function priceFor(prices: Prices, finish: Finish = 'nonfoil', currency: Currency = 'eur'): number | null {
  const regular = prices[currency];
  if (finish === 'nonfoil') return regular;
  return prices[`${currency}_foil`] ?? regular;
}

const formatters: Record<Currency, Intl.NumberFormat> = {
  eur: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }),
  usd: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }),
};

export function formatPrice(value: number, currency: Currency = 'eur'): string {
  return formatters[currency].format(value);
}
