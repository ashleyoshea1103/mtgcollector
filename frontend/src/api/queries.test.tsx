import { QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { cards, customGroups, entries } from '../fixtures';
import { EMPTY_SEARCH } from '../lib/search';
import { ann, fakeApi, type Routes } from '../test/app';
import { MaxSearchPage } from '../types';
import { keys } from './keys';
import * as q from './queries';
import { createQueryClient } from './queryClient';

const [binder, deck] = customGroups;

// One of everything a change might need to refresh, cached and not on screen (so it's marked
// stale rather than fetched again): the collection's, two groups', and everyone's card data.
const cached: Record<string, QueryKey> = {
  stats: keys.stats,
  copies: keys.copies(cards.lightningBolt.id),
  'collection groups': keys.listingGroups(null, 'none'),
  'collection entries': keys.listingEntries(null, 'none', 'all', 'name'),
  'groups list': keys.groupList,
  'binder': keys.group(binder.id),
  'binder groups': keys.listingGroups(binder.id, 'none'),
  'binder entries': keys.listingEntries(binder.id, 'none', 'all', 'name'),
  'binder member': keys.member(binder.id, entries.bolts.id),
  'deck': keys.group(deck.id),
  'deck entries': keys.listingEntries(deck.id, 'none', 'all', 'name'),
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
