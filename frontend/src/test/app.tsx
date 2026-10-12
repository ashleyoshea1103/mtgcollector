// Rendering the whole app against a fake API, for page tests: the real routes, query client,
// pages and components; only fetch is replaced.
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, vi } from 'vitest';
import { createQueryClient } from '../api/queryClient';
import { routes } from '../app/routes';
import type { User } from '../types';
import { Toaster } from '../ui/Toast';
import { toasts } from '../ui/toastQueue';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  // The JSON body sent, as parsed; tests check its shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** The :name parts of the route's path. */
  params: Record<string, string>;
}

/** An answer: 200 by default, or 204 without a body. */
export interface Reply {
  status?: number;
  body?: unknown;
}

export type Handler = Reply | ((req: FakeRequest) => Reply | Promise<Reply>);

/** Answers by "METHOD /path/:param", e.g. 'GET /api/groups/:id'. */
export type Routes = Record<string, Handler>;

export const ann: User = { id: 1, email: 'ann@example.com' };
export const signedIn: Routes = { 'GET /api/auth/me': { body: ann } };
export const signedOut: Routes = { 'GET /api/auth/me': { status: 401, body: { error: 'not signed in' } } };
/** The GBP rate the server has; renderApp answers with it unless a test's routes say otherwise. */
export const ratesApi: Routes = { 'GET /api/rates': { body: { rates: [{ currency: 'GBP', per_eur: 0.8712, date: '2026-10-09' }] } } };

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/** The route for a request: of those matching, the one with the fewest :params (the most literal). */
function bestMatch(routes: Routes, method: string, path: string) {
  let best: { handler: Handler; params: Record<string, string>; loose: number } | null = null;
  for (const [route, handler] of Object.entries(routes)) {
    const [m, pattern] = route.split(' ');
    const params = m === method ? matchPath(pattern, path) : null;
    if (!params) continue;
    const loose = Object.keys(params).length;
    if (!best || loose < best.loose) best = { handler, params, loose };
  }
  return best;
}

function respond({ status, body }: Reply): Response {
  if (body === undefined) return new Response(null, { status: status ?? 204 });
  return new Response(JSON.stringify(body), { status: status ?? 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Replaces fetch with routes. A request no route answers gets a 404 and is listed in
 * unhandled, so a test can check the page asked for nothing unexpected.
 */
export function fakeApi(routes: Routes) {
  const requests: FakeRequest[] = [];
  const unhandled: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input, init = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = init.method ?? 'GET';
      const req: FakeRequest = {
        method,
        path: url.pathname,
        query: url.searchParams,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        params: {},
      };
      requests.push(req);
      const match = bestMatch(routes, method, url.pathname);
      if (match) {
        req.params = match.params;
        return respond(typeof match.handler === 'function' ? await match.handler(req) : match.handler);
      }
      unhandled.push(`${method} ${url.pathname}${url.search}`);
      return respond({ status: 404, body: { error: 'no such API endpoint' } });
    }),
  );
  return {
    requests,
    unhandled,
    /** The requests one route answered, e.g. sent('POST /api/collection/entries'). */
    sent(route: string) {
      const [m, pattern] = route.split(' ');
      return requests.filter((r) => r.method === m && matchPath(pattern, r.path));
    },
  };
}

/** Renders the app at path, its API answered by routes. */
export function renderApp(path: string, routesForApi: Routes) {
  const api = fakeApi({ ...ratesApi, ...routesForApi });
  const client = createQueryClient({ queries: { retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...view, api, client, router, user, location: () => router.state.location };
}

// Toasts live in a queue shared by the whole app; none may carry over into the next test.
afterEach(() => {
  while (toasts.visibleToasts.length > 0) toasts.close(toasts.visibleToasts[0].key);
});
