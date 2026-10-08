import { describe, expect, it } from 'vitest';
import symbology from './symbology.json';
import { describeManaCost, describeManaSymbol, parseManaCost, splitSymbols, symbolImage, symbolWords } from './mana';

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

describe('symbolImage', () => {
  it.each([
    ['G', 'G.svg'],
    ['W/U', 'WU.svg'],
    ['2/W', '2W.svg'],
    ['W/U/P', 'WUP.svg'],
    ['T', 'T.svg'],
    ['10', '10.svg'],
    ['½', 'HALF.svg'],
  ])('finds Scryfall’s image for {%s}', (symbol, file) => {
    expect(symbolImage(symbol)).toBe(`https://svgs.scryfall.io/card-symbols/${file}`);
  });

  it.each(['NOPE', 'constructor', '__proto__', ''])('has none for {%s}, so it shows as text', (symbol) => {
    expect(symbolImage(symbol)).toBeNull();
  });

  it('only gives images on Scryfall’s symbol host, with plain paths', () => {
    const urls = Object.values(symbology).map((s) => s.svg);
    expect(urls.length).toBeGreaterThan(50);
    for (const url of urls) expect(url).toMatch(/^https:\/\/svgs\.scryfall\.io\/card-symbols\/[A-Za-z0-9]+\.svg$/);
  });
});

describe('symbolWords', () => {
  it.each([
    ['G', 'one green mana'],
    ['T', 'tap this permanent'],
    ['2', 'two generic mana'],
  ])('reads {%s} as Scryfall writes it: "%s"', (symbol, words) => {
    expect(symbolWords(symbol)).toBe(words);
  });

  it('falls back to the short form for a symbol Scryfall hasn’t got', () => {
    expect(symbolWords('2/NEW')).toBe('2 generic or NEW');
    expect(symbolWords('constructor')).toBe('constructor');
  });
});

describe('splitSymbols', () => {
  it('splits rules text around its symbols', () => {
    expect(splitSymbols('{T}: Add {G}.')).toEqual([{ symbol: 'T' }, { text: ': Add ' }, { symbol: 'G' }, { text: '.' }]);
  });

  it('keeps text with no symbols whole, line breaks included', () => {
    expect(splitSymbols('Tap target permanent.\nDraw a card.')).toEqual([{ text: 'Tap target permanent.\nDraw a card.' }]);
  });

  it('handles adjacent symbols and an empty string', () => {
    expect(splitSymbols('Dash {1}{R}')).toEqual([{ text: 'Dash ' }, { symbol: '1' }, { symbol: 'R' }]);
    expect(splitSymbols('')).toEqual([]);
  });
});
