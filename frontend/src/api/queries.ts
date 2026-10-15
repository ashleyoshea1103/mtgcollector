// The TanStack Query hooks the pages fetch and change data with. Pages pass what they return
// to the presentational components, which know nothing of the API.
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { uniqueItems } from '../lib/pages';
import { MaxSearchPage, type CardPage, type CollectionEntry, type CollectionGroups, type Credentials, type CustomGroupList, type EntryChange, type GroupBy, type GroupChange, type GroupMember, type NewEntry, type NewGroup, type SortBy } from '../types';
import * as api from './endpoints';
import { keys, type ListingId } from './keys';
import { forgetCachedUser, switchUser } from './queryClient';

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: ({ signal }) => api.me(signal) });
}

/** The page after this one of a paged card list, or null after the last. */
const nextCardPage = (last: CardPage) => (last.has_more && last.page < MaxSearchPage ? last.page + 1 : null);

export function useCardSearch(search: api.CardSearch, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.search(search),
    queryFn: ({ pageParam, signal }) => api.searchCards(search, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: nextCardPage,
    select: (data) => uniqueItems(data.pages.map((p) => p.cards), (c) => c.id),
    // The last results stay up while the next search runs, rather than blinking out at each pause in typing.
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCard(id: string, enabled = true) {
  return useQuery({ queryKey: keys.card(id), queryFn: ({ signal }) => api.card(id, signal), enabled });
}

export function usePrintings(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.printings(id),
    queryFn: ({ pageParam, signal }) => api.printings(id, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: nextCardPage,
    select: (data) => uniqueItems(data.pages.map((p) => p.cards), (c) => c.id),
    enabled,
  });
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: ({ signal }) => api.collectionStats(signal) });
}

/** The signed-in user's copies of one printing; pass enabled false when nobody is signed in. */
export function useCopies(cardId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.copies(cardId), queryFn: ({ signal }) => api.cardCopies(cardId, signal), enabled });
}

export function useCustomGroups() {
  return useQuery({ queryKey: keys.groupList, queryFn: ({ signal }) => api.customGroups(signal), select: (d) => d.groups });
}

export function useCustomGroup(id: number) {
  return useQuery({ queryKey: keys.group(id), queryFn: ({ signal }) => api.customGroup(id, signal) });
}

/** One entry's copies in a group (null when it has none there); enabled once a group is chosen. */
export function useGroupMember(groupId: number | null, entryId: number) {
  return useQuery({
    queryKey: keys.member(groupId ?? 0, entryId),
    queryFn: ({ signal }) => api.groupMember(groupId!, entryId, signal),
    enabled: groupId !== null,
  });
}

/**
 * Whether two listing keys differ only in their search (the last part, keys.listing*): then
 * the last search's results stay up while the next one's load, rather than blinking out at each
 * pause in typing. Another listing, grouping or order still shows as loading.
 */
const onlySearchChanged = (a: QueryKey, b: QueryKey) => a.length === b.length && a.slice(0, -1).every((part, i) => part === b[i]);

/** A listing's groups, and the search (q) they're for: during a new search, the last one's may be standing in. */
export interface ListingGroups extends CollectionGroups {
  q: string;
}

/** The groups of a listing (the collection, or a custom group), for one way of grouping, of the cards matching q. */
export function useListingGroups(id: ListingId, groupBy: GroupBy, q: string) {
  const queryKey = keys.listingGroups(id, groupBy, q);
  return useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<ListingGroups> => ({
      ...(await (id === null ? api.collectionGroups(groupBy, q, signal) : api.groupGroups(id, groupBy, q, signal))),
      q,
    }),
    placeholderData: (previous, previousQuery) => (previousQuery && onlySearchChanged(previousQuery.queryKey, queryKey) ? previous : undefined),
  });
}

/**
 * An entry as a listing shows it. In a custom group, entry has the group's copies and
 * their value (so tiles and rows show those), and member is the membership, whose
 * entry has all the copies.
 */
export interface ListedEntry {
  entry: CollectionEntry;
  member: GroupMember | null;
}

interface ListedPage {
  rows: ListedEntry[];
  next_cursor: string | null;
}

const asListed = (member: GroupMember): ListedEntry => ({
  entry: { ...member.entry, quantity: member.quantity, value_eur: member.value_eur },
  member,
});

/**
 * One group's entries matching q, a page at a time, fetched while enabled (its section is open).
 * While only the search changed, the last search's entries stand in (isPlaceholderData): the
 * section then shows them with the heading they came with.
 */
export function useListingEntries(id: ListingId, groupBy: GroupBy, key: string, sort: SortBy, q: string, enabled: boolean) {
  const queryKey = keys.listingEntries(id, groupBy, key, sort, q);
  return useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }): Promise<ListedPage> => {
      const page = { groupBy, key, sort, cursor: pageParam, q };
      if (id === null) {
        const res = await api.collectionEntries(page, signal);
        return { rows: res.entries.map((entry) => ({ entry, member: null })), next_cursor: res.next_cursor };
      }
      const res = await api.groupMembers(id, page, signal);
      return { rows: res.members.map(asListed), next_cursor: res.next_cursor };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    select: (data) => uniqueItems(data.pages.map((p) => p.rows), (r) => r.entry.id),
    placeholderData: (previous, previousQuery) => (previousQuery && onlySearchChanged(previousQuery.queryKey, queryKey) ? previous : undefined),
    enabled,
  });
}

/**
 * After a change to a group's copies: the group, its listing and the groups list (whose totals
 * and previews include it). The membership itself is set from the answer, not fetched again.
 */
const refreshGroup = (client: QueryClient, groupId: number) => {
  for (const queryKey of [keys.group(groupId), [...keys.listing(groupId), 'groups'], [...keys.listing(groupId), 'entries'], keys.groupList]) {
    void client.invalidateQueries({ queryKey });
  }
};

/** After a change to entries: everything about the user's cards, in the collection and in groups. */
const refreshOwned = (client: QueryClient) => {
  void client.invalidateQueries({ queryKey: ['collection'] });
  void client.invalidateQueries({ queryKey: ['groups'] });
};

// A login's variables are the password typed: kept no longer than the page showing the attempt.
export function useLogin() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (c: Credentials) => api.login(c), onSuccess: (user) => switchUser(client, user), gcTime: 0 });
}

export function useSignup() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (c: Credentials) => api.signup(c), onSuccess: (user) => switchUser(client, user), gcTime: 0 });
}

/**
 * Logging out. beforeForgetting runs first, once the server has ended the session: leave a
 * page that needs an account there, or forgetting the user would send it to the login page.
 */
export function useLogout(beforeForgetting?: () => unknown) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await beforeForgetting?.();
      await forgetCachedUser(client);
    },
  });
}

export function useAddEntry() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (e: NewEntry) => api.addEntry(e), onSuccess: () => refreshOwned(client) });
}

export function useChangeEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: number; change: EntryChange }) => api.changeEntry(id, change),
    onSuccess: () => refreshOwned(client),
  });
}

export function useDeleteEntry() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => api.deleteEntry(id), onSuccess: () => refreshOwned(client) });
}

export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (g: NewGroup) => api.createGroup(g),
    onSuccess: (group) => {
      // Its page, opened next, has it already.
      client.setQueryData(keys.group(group.id), group);
      void client.invalidateQueries({ queryKey: keys.groupList });
    },
  });
}

export function useChangeGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: number; change: GroupChange }) => api.changeGroup(id, change),
    onSuccess: (group) => {
      client.setQueryData(keys.group(group.id), group);
      void client.invalidateQueries({ queryKey: keys.groupList });
    },
  });
}

export function useDeleteGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    onSuccess: (_, id) => {
      // Marked stale but not refetched: the page showing the group is about to leave, and a
      // refetch now would only find it gone. Coming back to it refetches (and says so).
      void client.invalidateQueries({ queryKey: keys.listing(id), refetchType: 'none' });
      // Out of the list at once, rather than when the list is fetched again.
      client.setQueryData<CustomGroupList>(keys.groupList, (list) => list && { groups: list.groups.filter((g) => g.id !== id) });
      void client.invalidateQueries({ queryKey: keys.groupList });
    },
  });
}

export function useSetGroupMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, entryId, quantity }: { groupId: number; entryId: number; quantity: number }) =>
      api.setGroupMember(groupId, entryId, quantity),
    onSuccess: ({ member }, { groupId, entryId }) => {
      client.setQueryData(keys.member(groupId, entryId), member);
      refreshGroup(client, groupId);
    },
  });
}

export function useRemoveGroupMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, entryId }: { groupId: number; entryId: number }) => api.removeGroupMember(groupId, entryId),
    onSuccess: (_, { groupId, entryId }) => {
      client.setQueryData(keys.member(groupId, entryId), null);
      refreshGroup(client, groupId);
    },
  });
}
