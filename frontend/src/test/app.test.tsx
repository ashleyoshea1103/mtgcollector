import { describe, expect, it } from 'vitest';
import { fakeApi } from './app';

describe('fakeApi', () => {
  it('answers by the most literal route, whatever their order', async () => {
    fakeApi({
      'GET /api/cards/:id': (req) => ({ body: { card: req.params.id } }),
      'GET /api/cards/search': { body: { search: true } },
    });
    expect(await (await fetch('/api/cards/search?q=x')).json()).toEqual({ search: true });
    expect(await (await fetch('/api/cards/abc')).json()).toEqual({ card: 'abc' });
  });

  it('lists requests no route answered, answering them 404', async () => {
    const api = fakeApi({});
    expect((await fetch('/api/nothing?x=1', { method: 'POST' })).status).toBe(404);
    expect(api.unhandled).toEqual(['POST /api/nothing?x=1']);
  });
});
