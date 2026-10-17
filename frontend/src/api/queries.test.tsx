import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { cards, customGroups, entries } from '../fixtures';
import { EMPTY_SEARCH } from '../lib/search';
import { ann, fakeApi, type FakeRequest, type Reply, type Routes } from '../test/app';
import { MaxSearchPage, type GroupBy, type SortBy } from '../types';
import { keys, type ListingId } from './keys';
import * as q from './queries';
import { createQueryClient } from './queryClient';

const [binder, deck] = customGroups;

// One of everything a change might need to refresh, cached and not on screen (so it's marked
// stale rather than fetched again): the collection's, two groups', and everyone's card data.
const cached: Record<string, QueryKey> = {
  stats: keys.stats,
  copies: keys.copies(cards.lightningBolt.id),
  'collection groups': keys.listingGroups(null, 'none', ''),
  'collection entries': keys.listingEntries(null, 'none', 'all', 'name', ''),
  'groups list': keys.groupList,
  'binder': keys.group(binder.id),
  'binder groups': keys.listingGroups(binder.id, 'none', ''),
  'binder entries': keys.listingEntries(binder.id, 'none', 'all', 'name', ''),
  'binder member': keys.member(binder.id, entries.bolts.id),
  'deck': keys.group(deck.id),
  'deck entries': keys.listingEntries(deck.id, 'none', 'all', 'name', ''),
  'a card': keys.card(cards.lightningBolt.id),
};

function setup(routes: Routes = {}) {
  const api = fakeApi(routes);
  const client = createQueryClient({ queries: { retry: false } });
  client.setQueryData(keys.me, ann);
  for (const key of Object.values(cached)) client.setQueryData(key, { cached: true });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  /** The cached things now marked stale, by name. */
  const stale = () => Object.entries(cached).filter(([, key]) => client.getQueryState(key)?.isInvalidated).map(([name]) => name);
  return { api, client, wrapper, stale };
}

const everythingOwned = Object.keys(cached).filter((name) => name !== 'a card');

describe('what each change refreshes', () => {
  it.each<[string, (h: typeof q) => { mutateAsync: (v: never) => Promise<unknown> }, unknown, Routes]>([
    ['adding copies', (h) => h.useAddEntry(), { card_id: 'c', quantity: 1, finish: 'nonfoil', condition: 'NM', language: 'en', group_id: null }, { 'POST /api/collection/entries': { status: 201, body: entries.bolts } }],
    ['changing an entry', (h) => h.useChangeEntry(), { id: 1, change: { quantity: 2 } }, { 'PATCH /api/collection/entries/:id': { body: entries.bolts } }],
    ['removing an entry', (h) => h.useDeleteEntry(), 1, { 'DELETE /api/collection/entries/:id': { status: 204 } }],
  ])('%s: everything about the cards, and not card data', async (_, hook, variables, routes) => {
    const { wrapper, stale } = setup(routes);
    const { result } = renderHook(() => hook(q), { wrapper });
    await act(() => result.current.mutateAsync(variables as never));
    expect(stale()).toEqual(everythingOwned);
  });

  it('putting copies in a group: that group and the list, with the membership set from the answer', async () => {
    const member = { entry: entries.bolts, quantity: 3, value_eur: null, added_at: '2026-10-01T00:00:00Z' };
    const { wrapper, stale, client } = setup({ 'PUT /api/groups/:id/members/:entry': { body: member } });
    const { result } = renderHook(() => q.useSetGroupMember(), { wrapper });
    await act(() => result.current.mutateAsync({ groupId: binder.id, entryId: entries.bolts.id, quantity: 3 }));
    expect(stale()).toEqual(['groups list', 'binder', 'binder groups', 'binder entries']);
    expect(client.getQueryData(keys.member(binder.id, entries.bolts.id))).toEqual(member);
  });

  it('taking a card out of a group: likewise, the membership now none', async () => {
    const { wrapper, stale, client } = setup({ 'DELETE /api/groups/:id/members/:entry': { status: 204 } });
    const { result } = renderHook(() => q.useRemoveGroupMember(), { wrapper });
    await act(() => result.current.mutateAsync({ groupId: binder.id, entryId: entries.bolts.id }));
    expect(stale()).toEqual(['groups list', 'binder', 'binder groups', 'binder entries']);
    expect(client.getQueryData(keys.member(binder.id, entries.bolts.id))).toBeNull();
  });

  it('making a group: the list, with the new group cached for its page', async () => {
    const made = { ...binder, id: 9, name: 'New' };
    const { wrapper, stale, client } = setup({ 'POST /api/groups': { status: 201, body: made } });
    const { result } = renderHook(() => q.useCreateGroup(), { wrapper });
    await act(() => result.current.mutateAsync({ name: 'New', kind: 'binder', description: '' }));
    expect(stale()).toEqual(['groups list']);
    expect(client.getQueryData(keys.group(9))).toEqual(made);
  });

  it('changing a group: the list, with the group set from the answer', async () => {
    const changed = { ...binder, name: 'Trades' };
    const { wrapper, stale, client } = setup({ 'PATCH /api/groups/:id': { body: changed } });
    const { result } = renderHook(() => q.useChangeGroup(), { wrapper });
    await act(() => result.current.mutateAsync({ id: binder.id, change: { name: 'Trades' } }));
    expect(stale()).toEqual(['groups list']);
    expect(client.getQueryData(keys.group(binder.id))).toEqual(changed);
  });

  it('deleting a group: out of the list at once, and everything of it stale', async () => {
    const { wrapper, stale, client } = setup({ 'DELETE /api/groups/:id': { status: 204 } });
    client.setQueryData(keys.groupList, { groups: customGroups });
    const { result } = renderHook(() => q.useDeleteGroup(), { wrapper });
    await act(() => result.current.mutateAsync(binder.id));
    expect(client.getQueryData(keys.groupList)).toEqual({ groups: customGroups.filter((g) => g.id !== binder.id) });
    expect(stale()).toEqual(['groups list', 'binder', 'binder groups', 'binder entries', 'binder member']);
  });
});

describe('logging out', () => {
  it('runs what must happen first (leaving a page that needs an account) before forgetting the user', async () => {
    const { wrapper, client } = setup({ 'POST /api/auth/logout': { status: 204 } });
    const order: string[] = [];
    const { result } = renderHook(() => q.useLogout(() => order.push(client.getQueryData(keys.me) ? 'left, still signed in' : 'left, already forgotten')), { wrapper });
    await act(() => result.current.mutateAsync());
    expect(order).toEqual(['left, still signed in']);
    expect(client.getQueryData(keys.me)).toBeNull();
  });
});

describe('paged card lists', () => {
  it('stop at the last page the API serves, even if it says there are more', () => {
    const { wrapper, client } = setup();
    const search = { ...EMPTY_SEARCH, q: 'bolt' };
    const morePastPage = (page: number) => {
      client.setQueryData(keys.search(search), { pages: [{ cards: [], page, has_more: true }], pageParams: [page] });
      return renderHook(() => q.useCardSearch(search, false), { wrapper }).result.current.hasNextPage;
    };
    expect(morePastPage(MaxSearchPage - 1)).toBe(true);
    expect(morePastPage(MaxSearchPage)).toBe(false);
  });
});

describe('useGroupMember', () => {
  it('asks for nothing until a group is chosen', async () => {
    const { wrapper, api } = setup();
    renderHook(() => q.useGroupMember(null, entries.bolts.id), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.requests).toEqual([]);
  });
});

describe('onlySearchChanged', () => {
  it('is true only for the same listing, grouping and order with another search', () => {
    expect(q.onlySearchChanged(keys.listingGroups(null, 'color', 'elf'), keys.listingGroups(null, 'color', 'goblin'))).toBe(true);
    expect(q.onlySearchChanged(keys.listingEntries(null, 'none', 'all', 'name', ''), keys.listingEntries(null, 'none', 'all', 'name', 'elf'))).toBe(true);
    // The same key again (e.g. after it was dropped) brings nothing of the old query back.
    expect(q.onlySearchChanged(keys.listingGroups(null, 'color', 'elf'), keys.listingGroups(null, 'color', 'elf'))).toBe(false);
    expect(q.onlySearchChanged(keys.listingGroups(null, 'color', 'elf'), keys.listingGroups(null, 'type', 'goblin'))).toBe(false);
    expect(q.onlySearchChanged(keys.listingGroups(null, 'color', 'elf'), keys.listingGroups(binder.id, 'color', 'goblin'))).toBe(false);
    expect(q.onlySearchChanged(keys.listingEntries(null, 'none', 'all', 'name', ''), keys.listingEntries(null, 'none', 'all', 'price', 'elf'))).toBe(false);
  });
});

describe('a searched listing', () => {
  const groupsOf = (req: FakeRequest): Reply => ({ body: { group_by: req.query.get('group_by'), groups: [] } });
  // One entry for "goblin", none for anything else.
  const entriesOf = (req: FakeRequest): Reply => ({ body: { entries: req.query.get('q') === 'goblin' ? [entries.bolts] : [], next_cursor: null } });
  /** Routes that answer a search for "slow" only when release() is called. */
  function slowRoutes(answer: (req: FakeRequest) => Reply, ...routes: string[]) {
    const held = { release: () => {} };
    const handler = (req: FakeRequest) =>
      req.query.get('q') === 'slow' ? new Promise<Reply>((resolve) => (held.release = () => resolve(answer(req)))) : answer(req);
    return { held, routes: Object.fromEntries(routes.map((r) => [r, handler])) as Routes };
  }

  it('sends the search only when there is one, as typed, and its groups say which search they are for', async () => {
    const { wrapper, api } = setup({ 'GET /api/collection/groups': groupsOf, 'GET /api/groups/:id/groups': groupsOf });
    const { rerender, result } = renderHook(({ id, search }) => q.useListingGroups(id, 'color', search), {
      wrapper,
      initialProps: { id: null as ListingId, search: '' },
    });
    await waitFor(() => expect(result.current.data?.q).toBe(''));
    rerender({ id: null, search: "R&D's +1 #2" });
    await waitFor(() => expect(result.current.data?.q).toBe("R&D's +1 #2"));
    rerender({ id: binder.id, search: 'goblin' });
    await waitFor(() => expect(result.current.data?.q).toBe('goblin'));
    expect(api.requests.map((r) => [r.path, r.query.get('q')])).toEqual([
      ['/api/collection/groups', null],
      ['/api/collection/groups', "R&D's +1 #2"],
      [`/api/groups/${binder.id}/groups`, 'goblin'],
    ]);
  });

  it("keeps the last search's groups up while the next search's load, but not another grouping's or listing's", async () => {
    const { held, routes } = slowRoutes(groupsOf, 'GET /api/collection/groups', 'GET /api/groups/:id/groups');
    const { wrapper } = setup(routes);
    const { rerender, result } = renderHook(({ id, groupBy, search }) => q.useListingGroups(id, groupBy, search), {
      wrapper,
      initialProps: { id: null as ListingId, groupBy: 'color' as GroupBy, search: 'goblin' },
    });
    await waitFor(() => expect(result.current.data?.q).toBe('goblin'));

    rerender({ id: null, groupBy: 'color', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.q).toBe('goblin');
    act(() => held.release());
    await waitFor(() => expect(result.current.data?.q).toBe('slow'));
    expect(result.current.isPlaceholderData).toBe(false);

    rerender({ id: null, groupBy: 'type', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
    act(() => held.release());
    await waitFor(() => expect(result.current.data?.group_by).toBe('type'));

    rerender({ id: binder.id, groupBy: 'type', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("sends a section's search with its pages, and stands the last search's entries in only while just the search changed", async () => {
    const { held, routes } = slowRoutes(entriesOf, 'GET /api/collection/entries');
    const { wrapper, api } = setup(routes);
    const { rerender, result } = renderHook(({ groupBy, key, sort, search }) => q.useListingEntries(null, groupBy, key, sort, search, true), {
      wrapper,
      initialProps: { groupBy: 'none' as GroupBy, key: 'all', sort: 'cmc' as SortBy, search: 'goblin' },
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(api.requests[0].query.get('q')).toBe('goblin');

    rerender({ groupBy: 'none', key: 'all', sort: 'cmc', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toHaveLength(1);
    act(() => held.release());
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.isPlaceholderData).toBe(false);

    // Another order, or another group, starts from nothing.
    rerender({ groupBy: 'none', key: 'all', sort: 'price', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
    act(() => held.release());
    await waitFor(() => expect(result.current.data).toEqual([]));
    rerender({ groupBy: 'color', key: 'R', sort: 'price', search: 'slow' });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
