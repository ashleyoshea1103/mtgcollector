import { describe, expect, it } from 'vitest';
import type { Prices } from '../types';
import { formatPrice, priceFor } from './price';

const prices: Prices = { eur: 1.55, eur_foil: 5.56, usd: 1.87, usd_foil: 8.03 };
const noFoilPrice: Prices = { eur: 0.2, eur_foil: null, usd: 0.25, usd_foil: null };
const unpriced: Prices = { eur: null, eur_foil: null, usd: null, usd_foil: null };

describe('priceFor', () => {
  it('uses the regular EUR price for non-foil by default', () => {
    expect(priceFor(prices)).toBe(1.55);
  });

  it('uses the foil price for foil and etched', () => {
    expect(priceFor(prices, 'foil')).toBe(5.56);
    expect(priceFor(prices, 'etched')).toBe(5.56);
  });

  it('falls back to the regular price when there is no foil price', () => {
    expect(priceFor(noFoilPrice, 'foil')).toBe(0.2);
  });

  it('reads USD prices when asked', () => {
    expect(priceFor(prices, 'nonfoil', 'usd')).toBe(1.87);
    expect(priceFor(prices, 'foil', 'usd')).toBe(8.03);
  });

  it('returns null when the card has no price at all', () => {
    expect(priceFor(unpriced)).toBeNull();
    expect(priceFor(unpriced, 'foil')).toBeNull();
  });
});

describe('formatPrice', () => {
  it('formats with the currency symbol and two decimals', () => {
    expect(formatPrice(1.5)).toMatch(/€/);
    expect(formatPrice(1.5)).toMatch(/1[.,]50/);
    expect(formatPrice(57.4, 'usd')).toMatch(/\$/);
  });
});
