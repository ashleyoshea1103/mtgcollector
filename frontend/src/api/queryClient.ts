import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiError } from './client';
import type { User } from '../types';
import { keys } from './keys';

/**
 * The app's query client. Errors the user caused (4xx) aren't retried, and a 401 from
 * anything a signed-in user asked for means their session ended (it expired, or they
 * logged out in another tab): forgetCachedUser then sends them to log in.
 */
export function createQueryClient(defaults: DefaultOptions = {}): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401 && client.getQueryData(keys.me)) void forgetCachedUser(client);
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
  return client;
}

/**
 * Drops everything cached and records that nobody is signed in: on logging out, and when
 * the session turns out to have ended. Nothing one user saw is left for the next.
 */
export function forgetCachedUser(client: QueryClient): Promise<void> {
  return switchUser(client, null);
}

/**
 * Records who's signed in now, dropping everything cached for whoever was before. The
 * user's own query is kept and updated rather than dropped: the header and page guards
 * watch it, and a dropped query would leave them showing the old user. A fetch of it still
 * under way is cancelled first, or its older answer would land after this one.
 */
export async function switchUser(client: QueryClient, user: User | null): Promise<void> {
  await client.cancelQueries({ queryKey: keys.me });
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
  client.setQueryData(keys.me, user);
}
