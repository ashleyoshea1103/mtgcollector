import { describe, expect, it } from 'vitest';
import type { Prices } from '../types';
import { defaultFinish, formatPrice, priceFor } from './price';

const prices: Prices = { eur: 1.55, eur_foil: 5.56, usd: 1.87, usd_foil: 8.03, usd_etched: 6.5 };
const noFoilPrice: Prices = { eur: 0.2, eur_foil: null, usd: 0.25, usd_foil: null, usd_etched: null };
const unpriced: Prices = { eur: null, eur_foil: null, usd: null, usd_foil: null, usd_etched: null };

describe('priceFor', () => {
  it('uses the regular EUR price for non-foil by default', () => {
    expect(priceFor(prices)).toBe(1.55);
    expect(priceFor(prices, 'nonfoil')).toBe(1.55);
  });

  it('uses the foil price for foil', () => {
    expect(priceFor(prices, 'foil')).toBe(5.56);
  });

  it('values etched at the EUR foil price, as Scryfall has no EUR etched price', () => {
    expect(priceFor(prices, 'etched')).toBe(5.56);
  });

  it('uses the USD etched price for etched in USD', () => {
    expect(priceFor(prices, 'etched', 'usd')).toBe(6.5);
  });

  it('falls back from etched to foil to regular when prices are missing', () => {
    expect(priceFor({ ...prices, usd_etched: null }, 'etched', 'usd')).toBe(8.03);
    expect(priceFor(noFoilPrice, 'etched', 'usd')).toBe(0.25);
    expect(priceFor(noFoilPrice, 'foil')).toBe(0.2);
  });

  it('reads USD prices when asked', () => {
    expect(priceFor(prices, 'nonfoil', 'usd')).toBe(1.87);
    expect(priceFor(prices, 'foil', 'usd')).toBe(8.03);
  });

  it('does not fall back from non-foil to foil', () => {
    expect(priceFor({ ...unpriced, eur_foil: 40.2 }, 'nonfoil')).toBeNull();
  });

  it('returns null when the card has no price at all', () => {
    expect(priceFor(unpriced)).toBeNull();
    expect(priceFor(unpriced, 'foil')).toBeNull();
    expect(priceFor(unpriced, 'etched', 'usd')).toBeNull();
  });
});

describe('defaultFinish', () => {
  it('prefers non-foil when the printing has it', () => {
    expect(defaultFinish({ finishes: ['foil', 'nonfoil'] })).toBe('nonfoil');
  });

  it('uses the only finish of a foil-only or etched-only printing', () => {
    expect(defaultFinish({ finishes: ['foil'] })).toBe('foil');
    expect(defaultFinish({ finishes: ['etched'] })).toBe('etched');
  });

  it('falls back to non-foil when Scryfall lists no finishes', () => {
    expect(defaultFinish({ finishes: [] })).toBe('nonfoil');
  });
});

describe('formatPrice', () => {
  it('formats in the requested currency', () => {
    const eur = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(1.5);
    const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(57.4);
    expect(formatPrice(1.5)).toBe(eur);
    expect(formatPrice(57.4, 'usd')).toBe(usd);
  });
});
