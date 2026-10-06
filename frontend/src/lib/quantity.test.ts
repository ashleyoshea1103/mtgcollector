import { describe, expect, it } from 'vitest';
import { MAX_QUANTITY, parseQuantity } from './quantity';

describe('parseQuantity', () => {
  it('reads whole numbers', () => {
    expect(parseQuantity('1')).toBe(1);
    expect(parseQuantity('3')).toBe(3);
    expect(parseQuantity(String(MAX_QUANTITY))).toBe(MAX_QUANTITY);
  });

  it('drops fractions', () => {
    expect(parseQuantity('2.5')).toBe(2);
  });

  it('clamps to the maximum', () => {
    expect(parseQuantity(String(MAX_QUANTITY + 1))).toBe(MAX_QUANTITY);
    expect(parseQuantity('1e6')).toBe(MAX_QUANTITY);
  });

  it('treats empty, zero, negative and junk input as one', () => {
    for (const input of ['', '0', '-4', 'abc', 'Infinity', '0.5']) {
      expect(parseQuantity(input), input).toBe(1);
    }
  });
});
