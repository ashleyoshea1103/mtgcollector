import { describe, expect, it } from 'vitest';
import { uniqueItems } from './pages';

describe('uniqueItems', () => {
  it('joins the pages in order', () => {
    expect(uniqueItems([[{ id: 1 }, { id: 2 }], [{ id: 3 }]], (x) => x.id)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('keeps the first copy of an item that moved to a later page', () => {
    const moved = { id: 2, price: 'old' };
    expect(
      uniqueItems(
        [
          [{ id: 1 }, moved],
          [{ id: 2, price: 'new' }, { id: 4 }],
        ],
        (x) => x.id,
      ),
    ).toEqual([{ id: 1 }, moved, { id: 4 }]);
  });

  it('handles no pages and empty pages', () => {
    expect(uniqueItems([], (x: { id: string }) => x.id)).toEqual([]);
    expect(uniqueItems([[], [{ id: 'a' }], []], (x) => x.id)).toEqual([{ id: 'a' }]);
  });
});
