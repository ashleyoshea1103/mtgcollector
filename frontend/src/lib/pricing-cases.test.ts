/// <reference types="node" />
// Runs the pricing cases shared with the Go backend (testdata/pricing-cases.json),
// so the client and server rules can't drift apart unnoticed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Finish, Prices } from '../types';
import { defaultFinish, lineValue, priceFor, type Currency } from './price';

interface PricingCases {
  price_cases: { name: string; prices: Prices; finish: Finish; currency: Currency; expected: number | null }[];
  default_finish_cases: { name: string; finishes: Finish[]; expected: Finish }[];
  value_cases: { name: string; unit_price: number | null; quantity: number; expected: number | null }[];
}

const cases: PricingCases = JSON.parse(
  readFileSync(new URL('../../../testdata/pricing-cases.json', import.meta.url), 'utf8'),
);

describe('shared pricing cases', () => {
  it.each(cases.price_cases.map((c) => [c.name, c] as const))('priceFor: %s', (_, c) => {
    expect(priceFor(c.prices, c.finish, c.currency)).toBe(c.expected);
  });

  it.each(cases.default_finish_cases.map((c) => [c.name, c] as const))('defaultFinish: %s', (_, c) => {
    expect(defaultFinish({ finishes: c.finishes })).toBe(c.expected);
  });

  it.each(cases.value_cases.map((c) => [c.name, c] as const))('lineValue: %s', (_, c) => {
    expect(lineValue(c.unit_price, c.quantity)).toBe(c.expected);
  });
});
