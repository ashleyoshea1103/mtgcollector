import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiUrl, NetworkError, request, segment, send } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubFetch(answer: Response | Error | ((input: string, init: RequestInit) => Response)) {
  const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async (input, init) => {
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(input, init) : answer;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiUrl', () => {
  it('leaves out empty and missing values and encodes the rest', () => {
    expect(apiUrl('/api/x')).toBe('/api/x');
    expect(apiUrl('/api/x', { a: '', b: null, c: undefined })).toBe('/api/x');
    expect(apiUrl('/api/x', { key: 'R&D #1?', page: 2, extras: true })).toBe('/api/x?key=R%26D+%231%3F&page=2&extras=true');
  });

  it('keeps zero and false, which are values', () => {
    expect(apiUrl('/api/x', { key: 0, extras: false })).toBe('/api/x?key=0&extras=false');
  });
});

describe('segment', () => {
  it('encodes everything that could change the path', () => {
    expect(segment('../../auth/logout')).toBe('..%2F..%2Fauth%2Flogout');
    expect(segment('12?x=1#y')).toBe('12%3Fx%3D1%23y');
    expect(segment(42)).toBe('42');
  });
});

describe('send', () => {
  it('sends JSON to our own origin and returns the status and body', async () => {
    const fetch = stubFetch(json(201, { id: 3 }));
    await expect(send('POST', '/api/groups', { body: { name: 'Binder' } })).resolves.toEqual({ status: 201, body: { id: 3 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/groups');
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"Binder"}', credentials: 'same-origin' });
    expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
  });

  it('sends no body or content type without one', async () => {
    const fetch = stubFetch(json(200, {}));
    await send('GET', '/api/x', { query: { q: 'bolt' } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/x?q=bolt');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('returns no body for 204', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(request('DELETE', '/api/x')).resolves.toBeUndefined();
  });

  it("throws the API's error message with the status", async () => {
    stubFetch(json(409, { error: 'an account with that email already exists' }));
    const err = await request('POST', '/api/auth/signup').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'an account with that email already exists' });
  });

  it.each([
    [502, "the server isn't answering; try again shortly"],
    [504, "the server isn't answering; try again shortly"],
    [500, 'something went wrong on the server'],
    [418, 'the request failed (418)'],
  ])('stands in for a %i that has no API message', async (status, message) => {
    stubFetch(new Response('<html>Bad gateway</html>', { status }));
    await expect(request('GET', '/api/x')).rejects.toMatchObject({ status, message });
  });

  it("ignores an error body that isn't the API's shape", async () => {
    stubFetch(json(400, { error: { nested: true } }));
    await expect(request('GET', '/api/x')).rejects.toMatchObject({ status: 400, message: 'the request failed (400)' });
  });

  it('throws a NetworkError when the API is unreachable', async () => {
    stubFetch(new TypeError('Failed to fetch'));
    await expect(request('GET', '/api/x')).rejects.toBeInstanceOf(NetworkError);
  });

  it("throws a NetworkError when a success isn't JSON", async () => {
    stubFetch(new Response('<!doctype html>', { status: 200 }));
    await expect(request('GET', '/api/x')).rejects.toThrow(new NetworkError("the server's answer couldn't be read"));
  });

  it('passes a cancellation through while an error body is being read', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    const res = new Response('{}', { status: 500 });
    vi.spyOn(res, 'json').mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    stubFetch(res);
    await expect(request('GET', '/api/x', { signal: controller.signal })).rejects.toBe(abort);
  });

  it('passes a cancellation through as itself, not as a failure', async () => {
    const controller = new AbortController();
    const abort = new DOMException('aborted', 'AbortError');
    stubFetch(() => {
      controller.abort();
      throw abort;
    });
    await expect(request('GET', '/api/x', { signal: controller.signal })).rejects.toBe(abort);
  });
});
