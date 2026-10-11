import { describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError } from './client';
import { keys } from './keys';
import { createQueryClient, forgetCachedUser, switchUser } from './queryClient';

const ann = { id: 1, email: 'ann@example.com' };
const fail = (err: Error) => () => Promise.reject(err);

describe('createQueryClient', () => {
  it("retries what wasn't the user's fault, twice", () => {
    const retry = createQueryClient().getDefaultOptions().queries!.retry as (failures: number, err: Error) => boolean;
    expect(retry(0, new ApiError(503, 'busy'))).toBe(true);
    expect(retry(0, new ApiError(500, 'oops'))).toBe(true);
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
    await vi.waitFor(() => expect(client.getQueryData(keys.me)).toBeNull());
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
    await vi.waitFor(() => expect(client.getQueryData(keys.me)).toBeNull());
  });

  it("leaves everyone's data when nobody was signed in (a wrong password is a 401 too) or it wasn't a 401", async () => {
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

describe('a change of who is signed in, however it is found out', () => {
  const bob = { id: 2, email: 'bob@example.com' };
  const signedInAs = async (user: typeof ann | null) => {
    const client = createQueryClient({ queries: { retry: false } });
    client.setQueryData(keys.me, ann);
    client.setQueryData(keys.group(4), { id: 4, name: "Ann's binder" });
    await client.fetchQuery({ queryKey: keys.me, queryFn: () => Promise.resolve(user), staleTime: 0 });
    return client;
  };

  it("drops the last user's data when someone else is signed in now (another tab switched account)", async () => {
    expect((await signedInAs(bob)).getQueryData(keys.group(4))).toBeUndefined();
  });

  it("drops the last user's data when nobody is signed in now (their session ended)", async () => {
    expect((await signedInAs(null)).getQueryData(keys.group(4))).toBeUndefined();
  });

  it('keeps it when the same user is still signed in', async () => {
    expect((await signedInAs(ann)).getQueryData(keys.group(4))).toEqual({ id: 4, name: "Ann's binder" });
  });

  it("drops a user's data that outlived them when a 401 comes after", async () => {
    const client = createQueryClient({ queries: { retry: false } });
    client.setQueryData(keys.me, null);
    client.setQueryData(keys.stats, { card_count: 3 });
    client.setQueryData(keys.card('x'), { id: 'x' });
    await client.fetchQuery({ queryKey: keys.groupList, queryFn: fail(new ApiError(401, 'not signed in')) }).catch(() => {});
    expect(client.getQueryData(keys.stats)).toBeUndefined();
    // Card data is everyone's.
    expect(client.getQueryData(keys.card('x'))).toEqual({ id: 'x' });
  });

  it('forgets changes made, whose variables can hold a typed password', async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, null);
    await client.getMutationCache().build(client, { mutationFn: () => Promise.resolve(ann) }).execute({ email: ann.email, password: 'correct horse battery staple' });
    await switchUser(client, null);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it("tells the browser's other tabs, which check who's signed in", async () => {
    const here = createQueryClient();
    const there = createQueryClient();
    there.setQueryData(keys.me, ann);
    await switchUser(here, bob);
    await vi.waitFor(() => expect(there.getQueryState(keys.me)?.isInvalidated).toBe(true));
  });
});

describe('switchUser', () => {
  it("keeps the user's own query, updated, so whatever watches it sees the change", async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, null);
    const me = client.getQueryCache().find({ queryKey: keys.me });
    client.setQueryData(keys.stats, { card_count: 3 });
    await switchUser(client, ann);
    expect(client.getQueryCache().find({ queryKey: keys.me })).toBe(me);
    expect(client.getQueryData(keys.me)).toEqual(ann);
    expect(client.getQueryData(keys.stats)).toBeUndefined();
  });
});

describe('switchUser, racing a fetch of who is signed in', () => {
  it("isn't undone by the older answer arriving afterwards", async () => {
    const client = createQueryClient({ queries: { retry: false } });
    client.setQueryData(keys.me, null);
    const stale = client
      .fetchQuery({ queryKey: keys.me, queryFn: () => new Promise((resolve) => setTimeout(() => resolve(null), 30)), staleTime: 0 })
      .catch(() => {});
    await switchUser(client, ann);
    await stale;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.getQueryData(keys.me)).toEqual(ann);
  });
});

describe('forgetCachedUser', () => {
  it('drops everything cached and records that nobody is signed in', async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, ann);
    client.setQueryData(keys.group(4), { id: 4 });
    client.setQueryData(keys.search({ q: 'bolt', set: '', type: '', rarity: '', colors: '', extras: false }), { pages: [] });
    await forgetCachedUser(client);
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([keys.me]);
    expect(client.getQueryData(keys.me)).toBeNull();
  });
});
