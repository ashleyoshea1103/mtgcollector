import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiError } from './client';
import type { User } from '../types';
import { keys } from './keys';

/** The other tabs of this browser share the session cookie: a change of user in one is told to the rest. */
const SESSION_CHANNEL = 'mtgcollector-session';

/** Each client's channel to the other tabs, for switchUser to announce on. */
const channels = new WeakMap<QueryClient, BroadcastChannel>();

const isUserData = (key: readonly unknown[]) => key[0] === 'collection' || key[0] === 'groups';

/**
 * The app's query client. Errors the user caused (4xx) aren't retried. Nothing one user saw
 * is shown to another: whenever who's signed in changes (logging in or out here or in another
 * tab, or a session ending), everything cached is dropped, and a 401 from a signed-in
 * user's request means their session ended, which sends them to log in.
 */
export function createQueryClient(defaults: DefaultOptions = {}): QueryClient {
  const onError = (err: unknown) => {
    if (!(err instanceof ApiError && err.status === 401)) return;
    if (client.getQueryData(keys.me)) void forgetCachedUser(client);
    // Nobody is signed in by now, but a user's data may have outlived them.
    else client.removeQueries({ predicate: (q) => isUserData(q.queryKey) });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      ...defaults,
      queries: {
        retry: (failures, err) => failures < 2 && !(err instanceof ApiError && err.status < 500),
        staleTime: 30_000,
        ...defaults.queries,
      },
      mutations: { retry: false, ...defaults.mutations },
    },
  });

  // Whoever /api/auth/me says is signed in, however that's found out: a different user (or
  // nobody) from the last answer means everything else cached was someone else's.
  let signedInAs: number | null | undefined; // undefined until first known
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[0] !== keys.me[0]) return;
    const user = event.query.state.data as User | null | undefined;
    if (user === undefined) return;
    const id = user?.id ?? null;
    if (signedInAs !== undefined && id !== signedInAs) dropAllButMe(client);
    signedInAs = id;
  });

  // Another tab logged in or out: check who's signed in now.
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    // Node (the tests) mustn't be kept running by it.
    (channel as BroadcastChannel & { unref?: () => void }).unref?.();
    channel.addEventListener('message', () => void client.invalidateQueries({ queryKey: keys.me }));
    channels.set(client, channel);
  }
  return client;
}

/** Everything cached except who's signed in, including changes made (whose variables hold, e.g., a password typed to log in). */
function dropAllButMe(client: QueryClient) {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  client.getMutationCache().clear();
}

/**
 * Drops everything cached and records that nobody is signed in: on logging out, and when
 * the session turns out to have ended. Nothing one user saw is left for the next.
 */
export function forgetCachedUser(client: QueryClient): Promise<void> {
  return switchUser(client, null);
}

/**
 * Records who's signed in now, dropping everything cached for whoever was before, and tells
 * the browser's other tabs to check. The user's own query is kept and updated rather than
 * dropped: the header and page guards watch it, and a dropped query would leave them
 * showing the old user. A fetch of it still under way is cancelled first, or its older
 * answer would land after this one.
 */
export async function switchUser(client: QueryClient, user: User | null): Promise<void> {
  await client.cancelQueries({ queryKey: keys.me });
  dropAllButMe(client);
  client.setQueryData(keys.me, user);
  channels.get(client)?.postMessage('signed-in-user-changed');
}
