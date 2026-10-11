// How the app talks to its API: same-origin JSON over fetch. Endpoint functions are in
// endpoints.ts; the TanStack Query hooks the pages use are in queries.ts.

/** An error answer from the API: its HTTP status, and its message, which is safe to show. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The API couldn't be reached, or what came back wasn't the API's answer (e.g. a proxy's error page). */
export class NetworkError extends Error {
  constructor(message = "couldn't reach the server") {
    super(message);
    this.name = 'NetworkError';
  }
}

export type QueryValue = string | number | boolean | null | undefined;

/** A path with its query string. Empty and missing values are left out; the rest are encoded. */
export function apiUrl(path: string, query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(name, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** One path segment: ids and keys from the server are encoded, so none can change the path. */
export const segment = (value: string | number) => encodeURIComponent(String(value));

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** Sent as JSON. */
  body?: unknown;
  signal?: AbortSignal;
}

/** An answer's status (to tell 201 Created from 200) and body (undefined for 204). */
export interface Answer<T> {
  status: number;
  body: T;
}

/**
 * Sends a request and returns the answer, or throws an ApiError for an error status and a
 * NetworkError when the API can't be reached. A cancelled request throws the abort error,
 * so TanStack Query can tell it from a failure.
 */
export async function send<T>(method: Method, path: string, { query, body, signal }: RequestOptions = {}): Promise<Answer<T>> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The session cookie goes to our own origin only.
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError();
  }
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return { status: res.status, body: undefined as T };
  try {
    return { status: res.status, body: (await res.json()) as T };
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError("the server's answer couldn't be read");
  }
}

/** Sends a request and returns the answer's body. */
export async function request<T>(method: Method, path: string, options?: RequestOptions): Promise<T> {
  return (await send<T>(method, path, options)).body;
}

/** The error an error answer stands for: the API's own message, or a stand-in when it has none. */
async function errorOf(res: Response): Promise<ApiError> {
  let message = '';
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') message = body.error;
  } catch {
    // Not the API's JSON: a proxy or gateway answered.
  }
  return new ApiError(res.status, message || fallbackMessage(res.status));
}

function fallbackMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) return "the server isn't answering; try again shortly";
  if (status >= 500) return 'something went wrong on the server';
  return `the request failed (${status})`;
}
