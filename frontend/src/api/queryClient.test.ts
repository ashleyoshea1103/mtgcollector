import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from './client';
import { keys } from './keys';
import { createQueryClient, forgetCachedUser, switchUser } from './queryClient';

const ann = { id: 1, email: 'ann@example.com' };
const fail = (err: Error) => () => Promise.reject(err);

describe('createQueryClient', () => {
  it("retries what wasn't the user's fault, twice", () => {
    const retry = createQueryClient().getDefaultOptions().queries!.retry as (failures: number, err: Error) => boolean;
    expect(retry(0, new ApiError(503, 'busy'))).toBe(true);
    expect(retry(1, new NetworkError())).toBe(true);
    expect(retry(2, new ApiError(500, 'oops'))).toBe(false);
    expect(retry(0, new ApiError(404, 'no such group'))).toBe(false);
    expect(retry(0, new ApiError(400, 'bad'))).toBe(false);
  });

  it('never retries a change', () => {
    expect(createQueryClient().getDefaultOptions().mutations!.retry).toBe(false);
  });

  it('forgets the user and their data when their session turns out to have ended', async () => {
    const client = createQueryClient({ queries: { retry: false } });
    client.setQueryData(keys.me, ann);
    client.setQueryData(keys.stats, { card_count: 3 });
    await client.fetchQuery({ queryKey: keys.groupList, queryFn: fail(new ApiError(401, 'not signed in')) }).catch(() => {});
    expect(client.getQueryData(keys.me)).toBeNull();
    expect(client.getQueryData(keys.stats)).toBeUndefined();
  });

  it('does the same when a change gets a 401', async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, ann);
    await client
      .getMutationCache()
      .build(client, { mutationFn: fail(new ApiError(401, 'not signed in')) })
      .execute(undefined)
      .catch(() => {});
    expect(client.getQueryData(keys.me)).toBeNull();
  });

  it("leaves everything when nobody was signed in (a wrong password is a 401 too) or it wasn't a 401", async () => {
    const client = createQueryClient({ queries: { retry: false } });
    client.setQueryData(keys.me, null);
    client.setQueryData(keys.card('x'), { id: 'x' });
    await client.getMutationCache().build(client, { mutationFn: fail(new ApiError(401, 'email or password is incorrect')) }).execute(undefined).catch(() => {});
    expect(client.getQueryData(keys.card('x'))).toEqual({ id: 'x' });

    client.setQueryData(keys.me, ann);
    await client.fetchQuery({ queryKey: keys.stats, queryFn: fail(new ApiError(403, 'forbidden')) }).catch(() => {});
    expect(client.getQueryData(keys.me)).toEqual(ann);
  });
});

describe('switchUser', () => {
  it("keeps the user's own query, updated, so whatever watches it sees the change", () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, null);
    const me = client.getQueryCache().find({ queryKey: keys.me });
    client.setQueryData(keys.stats, { card_count: 3 });
    switchUser(client, ann);
    expect(client.getQueryCache().find({ queryKey: keys.me })).toBe(me);
    expect(client.getQueryData(keys.me)).toEqual(ann);
    expect(client.getQueryData(keys.stats)).toBeUndefined();
  });
});

describe('forgetCachedUser', () => {
  it('drops everything cached and records that nobody is signed in', () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, ann);
    client.setQueryData(keys.group(4), { id: 4 });
    client.setQueryData(keys.search({ q: 'bolt', set: '', type: '', rarity: '', colors: '', extras: false }), { pages: [] });
    forgetCachedUser(client);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([keys.me]);
    expect(client.getQueryData(keys.me)).toBeNull();
  });
});
