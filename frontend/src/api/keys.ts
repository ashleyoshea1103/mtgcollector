import type { CardSearch } from './endpoints';
import type { GroupBy, SortBy } from '../types';

/**
 * Which listing: the whole collection (null) or one custom group (its id). The collection
 * and a group are listed the same way, by the same pages.
 */
export type ListingId = number | null;

const listing = (id: ListingId) => (id === null ? (['collection'] as const) : (['groups', id] as const));

/**
 * Query keys. Everything about the user's cards starts 'collection' or 'groups', so a change
 * can refresh all of it at once; card data ('cards') is the same for everyone.
 */
export const keys = {
  me: ['me'] as const,
  search: (s: CardSearch) => ['cards', 'search', s] as const,
  card: (id: string) => ['cards', 'card', id] as const,
  printings: (id: string) => ['cards', 'printings', id] as const,
  // The euro exchange rates, for showing prices in pounds: public, like card data.
  rates: ['rates'] as const,
  stats: ['collection', 'stats'] as const,
  copies: (cardId: string) => ['collection', 'copies', cardId] as const,
  groupList: ['groups', 'list'] as const,
  group: (id: number) => ['groups', id, 'detail'] as const,
  member: (groupId: number, entryId: number) => ['groups', groupId, 'member', entryId] as const,
  listing,
  listingGroups: (id: ListingId, groupBy: GroupBy) => [...listing(id), 'groups', groupBy] as const,
  listingEntries: (id: ListingId, groupBy: GroupBy, key: string, sort: SortBy) => [...listing(id), 'entries', groupBy, key, sort] as const,
};
