import { describe, expect, it } from 'vitest';
import { parseManaCost } from './mana';

describe('parseManaCost', () => {
  it('splits a cost into symbols', () => {
    expect(parseManaCost('{2}{R}{R}')).toEqual([['2', 'R', 'R']]);
  });

  it('keeps hybrid, Phyrexian and X symbols whole', () => {
    expect(parseManaCost('{X}{W/U}{B/P}')).toEqual([['X', 'W/U', 'B/P']]);
  });

  it('returns one array per half of a split card', () => {
    expect(parseManaCost('{1}{R} // {1}{U}')).toEqual([
      ['1', 'R'],
      ['1', 'U'],
    ]);
  });

  it('returns nothing for cards without a mana cost', () => {
    expect(parseManaCost('')).toEqual([]);
  });
});
