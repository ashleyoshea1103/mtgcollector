import { describe, expect, it } from 'vitest';
import { MaxSearchLength } from '../types';
import { canSearch, EMPTY_SEARCH, isSetCode, readSearch, writeSearch } from './search';

const q = (s: string) => new URLSearchParams(s);

describe('readSearch', () => {
  it('reads every filter', () => {
    expect(readSearch(q('q=bolt&set=MH2&type=instant&rarity=rare&colors=rw&extras=true'))).toEqual({
      q: 'bolt',
      set: 'mh2',
      type: 'instant',
      rarity: 'rare',
      colors: 'WR',
      extras: true,
    });
  });

  it("drops what the API would refuse", () => {
    expect(readSearch(q('rarity=legendary&colors=XYZ&extras=yes'))).toEqual(EMPTY_SEARCH);
    expect(readSearch(q('rarity=__proto__')).rarity).toBe('');
  });

  it('keeps colourless alone, and colors once each in WUBRG order', () => {
    expect(readSearch(q('colors=c')).colors).toBe('C');
    expect(readSearch(q('colors=GGUW')).colors).toBe('WUG');
    expect(readSearch(q('colors=CR')).colors).toBe('R');
  });

  it('cuts names and types to the longest the API takes', () => {
    expect(readSearch(q(`q=${'x'.repeat(MaxSearchLength + 9)}`)).q).toHaveLength(MaxSearchLength);
    expect(readSearch(q(`type=${'y'.repeat(MaxSearchLength + 1)}`)).type).toHaveLength(MaxSearchLength);
  });

  it('cuts between characters, never inside one', () => {
    const emoji = '🃏';
    const cut = readSearch(new URLSearchParams({ q: emoji.repeat(MaxSearchLength + 1) })).q;
    // Whole emoji only: no half of a surrogate pair left at the end.
    expect(cut).toBe(emoji.repeat(MaxSearchLength));
  });
});

describe('writeSearch', () => {
  it('writes only what is set, trimmed', () => {
    expect(writeSearch({ ...EMPTY_SEARCH, q: ' bolt ', set: ' MH2' }).toString()).toBe('q=bolt&set=mh2');
    expect(writeSearch(EMPTY_SEARCH).toString()).toBe('');
  });

  it('round-trips', () => {
    const s = { q: 'llanowar elves', set: 'dom', type: 'Elf', rarity: 'common', colors: 'G', extras: true } as const;
    expect(readSearch(writeSearch(s))).toEqual(s);
  });
});

describe('canSearch', () => {
  it('needs a word with three letters or digits in a row', () => {
    expect(canSearch({ ...EMPTY_SEARCH, q: 'bol' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, q: 'of the elf' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, q: 'Æth' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, q: '火の玉' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, q: 'bo' })).toBe(false);
    expect(canSearch({ ...EMPTY_SEARCH, q: 'a-b-c' })).toBe(false);
    expect(canSearch({ ...EMPTY_SEARCH, q: 'ab cd' })).toBe(false);
    expect(canSearch(EMPTY_SEARCH)).toBe(false);
  });

  it('counts decimal digits only, as the server does', () => {
    expect(canSearch({ ...EMPTY_SEARCH, q: '123' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, q: '½⅓¼' })).toBe(false);
  });

  it('needs no name with a set, but the set code must look like one', () => {
    expect(canSearch({ ...EMPTY_SEARCH, set: 'mh2' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, set: 'mh2', q: 'x' })).toBe(true);
    expect(canSearch({ ...EMPTY_SEARCH, set: 'not a set', q: 'bolt' })).toBe(false);
  });
});

describe('isSetCode', () => {
  it('is up to 8 letters and digits', () => {
    expect(isSetCode('mh2')).toBe(true);
    expect(isSetCode(' PLST ')).toBe(true);
    expect(isSetCode('a')).toBe(true);
    expect(isSetCode('abcdefgh')).toBe(true);
    expect(isSetCode('abcdefghi')).toBe(false);
    expect(isSetCode('mh-2')).toBe(false);
    expect(isSetCode('')).toBe(false);
  });
});
