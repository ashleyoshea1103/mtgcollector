import { describe, expect, it } from 'vitest';
import { DEFAULT_LISTING, readListing, writeListing } from './listingParams';

const q = (s: string) => new URLSearchParams(s);

describe('readListing', () => {
  it('reads the grouping, order, view and search', () => {
    expect(readListing(q('group_by=color&sort=price&view=list&q=goblin'))).toEqual({ groupBy: 'color', sort: 'price', view: 'list', q: 'goblin' });
  });

  it('uses the defaults for missing or unknown values', () => {
    expect(readListing(q(''))).toEqual(DEFAULT_LISTING);
    expect(readListing(q('group_by=owner&sort=__proto__&view=table'))).toEqual(DEFAULT_LISTING);
    expect(readListing(q('group_by=toString'))).toEqual(DEFAULT_LISTING);
  });

  it('reads a search as its words, one space apart', () => {
    expect(readListing(q('q=%20%20goblin%20%20king%20')).q).toBe('goblin king');
    expect(readListing(q('q=%20%20')).q).toBe('');
  });
});

describe('writeListing', () => {
  it('sets what differs from the defaults and keeps other parameters', () => {
    expect(writeListing(q('x=1'), { groupBy: 'set', sort: 'added', view: 'list', q: 'elf' }).toString()).toBe('x=1&group_by=set&sort=added&view=list&q=elf');
  });

  it('leaves the defaults out', () => {
    expect(writeListing(q('group_by=set&sort=cmc&view=list&q=elf'), DEFAULT_LISTING).toString()).toBe('');
  });

  it('writes a search as its words, one space apart, and none when there are none', () => {
    expect(writeListing(q(''), { ...DEFAULT_LISTING, q: '  goblin \t king ' }).toString()).toBe('q=goblin+king');
    expect(writeListing(q('q=elf'), { ...DEFAULT_LISTING, q: '   ' }).toString()).toBe('');
  });

  it("doesn't change the params it's given", () => {
    const params = q('group_by=set');
    writeListing(params, DEFAULT_LISTING);
    expect(params.toString()).toBe('group_by=set');
  });

  it('round-trips', () => {
    const listing = { groupBy: 'cmc', sort: 'cmc', view: 'grid', q: "R&D's +1 #2" } as const;
    expect(readListing(writeListing(q(''), listing))).toEqual(listing);
  });
});
