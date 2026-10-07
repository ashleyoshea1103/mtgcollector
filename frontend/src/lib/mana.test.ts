import { describe, expect, it } from 'vitest';
import { describeManaCost, describeManaSymbol, parseManaCost } from './mana';

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

describe('describeManaCost', () => {
  it('reads generic and colored mana', () => {
    expect(describeManaCost('{2}{R}{R}')).toBe('2 generic, red, red');
  });

  it('reads hybrid, Phyrexian and other symbols', () => {
    expect(describeManaCost('{X}{W/U}{B/P}{G/U/P}{2/W}{C}')).toBe(
      'X, white or blue, Phyrexian black, Phyrexian green or blue, 2 generic or white, colorless',
    );
  });

  it('reads both halves of a split card', () => {
    expect(describeManaCost('{1}{R} // {1}{U}')).toBe('1 generic, red, then 1 generic, blue');
  });

  it('passes unknown symbols through', () => {
    expect(describeManaCost('{½}{∞}')).toBe('½, ∞');
  });
});

describe('describeManaSymbol', () => {
  it.each([
    ['2', '2 generic'],
    ['R', 'red'],
    ['W/U', 'white or blue'],
    ['B/P', 'Phyrexian black'],
    ['W/U/P', 'Phyrexian white or blue'],
    ['2/W', '2 generic or white'],
    ['T', 'tap'],
    ['?', '?'],
  ])('names {%s} as "%s"', (symbol, words) => {
    expect(describeManaSymbol(symbol)).toBe(words);
  });

  it("doesn't treat inherited object keys as symbol names", () => {
    expect(describeManaSymbol('constructor')).toBe('constructor');
  });
});
