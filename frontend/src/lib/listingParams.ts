import type { CollectionView } from '../components/GroupBucketSection';
import { MaxSearchLength, type GroupBy, type SortBy } from '../types';

/** How a listing (the collection, or a group) is shown: kept in the URL, so it survives a reload and can be linked. */
export interface ListingParams {
  groupBy: GroupBy;
  sort: SortBy;
  view: CollectionView;
  /** Words every card listed has in its name or type line, one space apart; '' lists every card. */
  q: string;
}

export const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: 'Nothing',
  set: 'Set',
  color: 'Color',
  type: 'Type',
  rarity: 'Rarity',
  cmc: 'Mana value',
};

export const SORT_LABELS: Record<SortBy, string> = {
  name: 'Name',
  price: 'Price (highest first)',
  cmc: 'Mana value',
  added: 'Newest first',
};

export const VIEW_LABELS: Record<CollectionView, string> = { grid: 'Grid', list: 'List' };

export const DEFAULT_LISTING: ListingParams = { groupBy: 'none', sort: 'name', view: 'grid', q: '' };

/** A search as the listing keeps it: its words, one space apart (the server splits it the same way). */
export const normaliseSearch = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');

const oneOf = <T extends string>(labels: Record<T, string>, value: string | null, fallback: T): T =>
  value !== null && Object.hasOwn(labels, value) ? (value as T) : fallback;

/** The listing's settings in a URL's query; unknown or missing values are the defaults. */
export function readListing(params: URLSearchParams): ListingParams {
  return {
    groupBy: oneOf(GROUP_BY_LABELS, params.get('group_by'), DEFAULT_LISTING.groupBy),
    sort: oneOf(SORT_LABELS, params.get('sort'), DEFAULT_LISTING.sort),
    view: oneOf(VIEW_LABELS, params.get('view'), DEFAULT_LISTING.view),
    // As much as the server takes, so a hand-edited link still lists something.
    q: normaliseSearch([...(params.get('q') ?? '').replaceAll('\0', '')].slice(0, MaxSearchLength).join('')),
  };
}

/** params with the listing's settings in them; defaults are left out, to keep URLs short. */
export function writeListing(params: URLSearchParams, listing: ListingParams): URLSearchParams {
  const out = new URLSearchParams(params);
  const set = (name: string, value: string, fallback: string) => (value === fallback ? out.delete(name) : out.set(name, value));
  set('group_by', listing.groupBy, DEFAULT_LISTING.groupBy);
  set('sort', listing.sort, DEFAULT_LISTING.sort);
  set('view', listing.view, DEFAULT_LISTING.view);
  set('q', normaliseSearch(listing.q), DEFAULT_LISTING.q);
  return out;
}
