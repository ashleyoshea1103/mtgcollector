import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './endpoints';
import { EMPTY_SEARCH } from '../lib/search';

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** Answers every request with status and body, and records what was sent. */
function stubApi(status = 200, body: unknown = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ method: init.method!, url, body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status });
    }),
  );
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const page = { groupBy: 'set', key: 'mh2', sort: 'price', cursor: null } as const;

describe('endpoints', () => {
  // Each endpoint's method, URL and body, with ids and keys that would break a URL if not encoded.
  it.each<[string, () => Promise<unknown>, string, string, unknown?]>([
    ['login', () => api.login({ email: 'a@b.c', password: 'p' }), 'POST', '/api/auth/login', { email: 'a@b.c', password: 'p' }],
    ['signup', () => api.signup({ email: 'a@b.c', password: 'p' }), 'POST', '/api/auth/signup', { email: 'a@b.c', password: 'p' }],
    ['logout', () => api.logout(), 'POST', '/api/auth/logout'],
    ['autocomplete', () => api.autocomplete('bolt'), 'GET', '/api/cards/autocomplete?q=bolt'],
    ['card', () => api.card('a/b?c'), 'GET', '/api/cards/a%2Fb%3Fc'],
    ['printings', () => api.printings('id', 2), 'GET', '/api/cards/id/printings?page=2'],
    ['collectionGroups', () => api.collectionGroups('color'), 'GET', '/api/collection/groups?group_by=color'],
    ['collectionEntries', () => api.collectionEntries(page), 'GET', '/api/collection/entries?group_by=set&key=mh2&sort=price'],
    [
      'collectionEntries, a later page',
      () => api.collectionEntries({ groupBy: 'type', key: 'R&D', sort: 'name', cursor: 'abc+/=' }),
      'GET',
      '/api/collection/entries?group_by=type&key=R%26D&sort=name&cursor=abc%2B%2F%3D',
    ],
    ['collectionStats', () => api.collectionStats(), 'GET', '/api/collection/stats'],
    ['cardCopies', () => api.cardCopies('x#y'), 'GET', '/api/collection/cards/x%23y'],
    ['changeEntry', () => api.changeEntry(5, { quantity: 2 }), 'PATCH', '/api/collection/entries/5', { quantity: 2 }],
    ['customGroups', () => api.customGroups(), 'GET', '/api/groups'],
    ['createGroup', () => api.createGroup({ name: 'B', kind: 'deck', description: '' }), 'POST', '/api/groups', { name: 'B', kind: 'deck', description: '' }],
    ['customGroup', () => api.customGroup(4), 'GET', '/api/groups/4'],
    ['changeGroup', () => api.changeGroup(4, { name: 'C' }), 'PATCH', '/api/groups/4', { name: 'C' }],
    ['groupGroups', () => api.groupGroups(4, 'rarity'), 'GET', '/api/groups/4/groups?group_by=rarity'],
    ['groupMembers', () => api.groupMembers(4, page), 'GET', '/api/groups/4/members?group_by=set&key=mh2&sort=price'],
    ['groupMember', () => api.groupMember(4, 7), 'GET', '/api/groups/4/members/7'],
  ])('%s', async (_, call, method, url, body) => {
    const sent = stubApi();
    await call();
    expect(sent).toEqual([{ method, url, body }]);
  });

  it.each<[string, () => Promise<unknown>, string, string]>([
    ['deleteEntry', () => api.deleteEntry(5), 'DELETE', '/api/collection/entries/5'],
    ['deleteGroup', () => api.deleteGroup(4), 'DELETE', '/api/groups/4'],
    ['removeGroupMember', () => api.removeGroupMember(4, 7), 'DELETE', '/api/groups/4/members/7'],
  ])('%s', async (_, call, method, url) => {
    const sent = stubApi(204);
    await expect(call()).resolves.toBeUndefined();
    expect(sent).toEqual([{ method, url, body: undefined }]);
  });

  it('searches with only the filters given, trimmed', async () => {
    const sent = stubApi(200, { cards: [], page: 1, has_more: false });
    await api.searchCards({ ...EMPTY_SEARCH, q: ' bolt ', set: ' mh2 ' }, 1);
    await api.searchCards({ q: 'elf', set: '', type: 'Creature — Elf', rarity: 'rare', colors: 'G', extras: true }, 3);
    expect(sent.map((s) => s.url)).toEqual([
      '/api/cards/search?q=bolt&set=mh2&page=1',
      '/api/cards/search?q=elf&type=Creature+%E2%80%94+Elf&rarity=rare&colors=G&extras=true&page=3',
    ]);
  });

  it('says whether an add made a new entry', async () => {
    const entry = { card_id: 'c', quantity: 1, finish: 'foil', condition: 'NM', language: 'en', group_id: 2 } as const;
    let sent = stubApi(201, { id: 9 });
    await expect(api.addEntry(entry)).resolves.toEqual({ entry: { id: 9 }, created: true });
    expect(sent).toEqual([{ method: 'POST', url: '/api/collection/entries', body: entry }]);
    sent = stubApi(200, { id: 9 });
    await expect(api.addEntry(entry)).resolves.toEqual({ entry: { id: 9 }, created: false });
  });

  it('says whether copies went into a group for the first time', async () => {
    const sent = stubApi(201, { quantity: 2 });
    await expect(api.setGroupMember(4, 7, 2)).resolves.toEqual({ member: { quantity: 2 }, created: true });
    expect(sent).toEqual([{ method: 'PUT', url: '/api/groups/4/members/7', body: { quantity: 2 } }]);
    stubApi(200, { quantity: 3 });
    await expect(api.setGroupMember(4, 7, 3)).resolves.toEqual({ member: { quantity: 3 }, created: false });
  });

  it('reads nobody signed in from a 401, and nothing else', async () => {
    stubApi(200, { id: 1, email: 'a@b.c' });
    await expect(api.me()).resolves.toEqual({ id: 1, email: 'a@b.c' });
    stubApi(401, { error: 'not signed in' });
    await expect(api.me()).resolves.toBeNull();
    stubApi(500, { error: 'something went wrong' });
    await expect(api.me()).rejects.toMatchObject({ status: 500 });
  });

  it('reads an entry not in a group from a 404, and nothing else', async () => {
    stubApi(404, { error: "that entry isn't in this group" });
    await expect(api.groupMember(4, 7)).resolves.toBeNull();
    stubApi(503, { error: 'that took too long; try again' });
    await expect(api.groupMember(4, 7)).rejects.toMatchObject({ status: 503 });
  });
});
