import { describe, expect, it } from 'vitest';
import { countOf } from './format';

describe('countOf', () => {
  it('uses the singular only for one', () => {
    expect(countOf(0, 'card')).toBe('0 cards');
    expect(countOf(1, 'card')).toBe('1 card');
    expect(countOf(2, 'card')).toBe('2 cards');
  });

  it('accepts an irregular plural', () => {
    expect(countOf(2, 'box', 'boxes')).toBe('2 boxes');
  });
});
