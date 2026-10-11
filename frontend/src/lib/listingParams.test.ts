import { describe, expect, it } from 'vitest';
import { DEFAULT_LISTING, readListing, writeListing } from './listingParams';

const q = (s: string) => new URLSearchParams(s);

describe('readListing', () => {
  it('reads the grouping, order and view', () => {
    expect(readListing(q('group_by=color&sort=price&view=list'))).toEqual({ groupBy: 'color', sort: 'price', view: 'list' });
  });

  it('uses the defaults for missing or unknown values', () => {
    expect(readListing(q(''))).toEqual(DEFAULT_LISTING);
    expect(readListing(q('group_by=owner&sort=__proto__&view=table'))).toEqual(DEFAULT_LISTING);
    expect(readListing(q('group_by=toString'))).toEqual(DEFAULT_LISTING);
  });
});

describe('writeListing', () => {
  it('sets what differs from the defaults and keeps other parameters', () => {
    expect(writeListing(q('x=1'), { groupBy: 'set', sort: 'added', view: 'list' }).toString()).toBe('x=1&group_by=set&sort=added&view=list');
  });

  it('leaves the defaults out', () => {
    expect(writeListing(q('group_by=set&sort=cmc&view=list'), DEFAULT_LISTING).toString()).toBe('');
  });

  it("doesn't change the params it's given", () => {
    const params = q('group_by=set');
    writeListing(params, DEFAULT_LISTING);
    expect(params.toString()).toBe('group_by=set');
  });

  it('round-trips', () => {
    const listing = { groupBy: 'cmc', sort: 'cmc', view: 'grid' } as const;
    expect(readListing(writeListing(q(''), listing))).toEqual(listing);
  });
});
