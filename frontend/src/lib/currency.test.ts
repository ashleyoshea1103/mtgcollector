import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCurrency, storedCurrency } from './currency';

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
};

/** Makes reading this browser's storage throw, as it does where the user blocks the site's data. */
function blockStorage() {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  return () => {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
}

let unblock: (() => void) | undefined;
afterEach(() => {
  unblock?.();
  unblock = undefined;
});

describe('storedCurrency', () => {
  it('is euros unless pounds were chosen', () => {
    expect(storedCurrency(memory())).toBe('eur');
    expect(storedCurrency(memory({ 'mtgcollector-currency': 'gbp' }))).toBe('gbp');
    expect(storedCurrency(memory({ 'mtgcollector-currency': 'usd' }))).toBe('eur');
  });

  it('is euros when storage is unavailable', () => {
    unblock = blockStorage();
    expect(storedCurrency()).toBe('eur');
    expect(
      storedCurrency({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('eur');
  });
});

describe('saveCurrency', () => {
  it('remembers the choice for storedCurrency', () => {
    const storage = memory();
    saveCurrency('gbp', storage);
    expect(storedCurrency(storage)).toBe('gbp');
    saveCurrency('eur', storage);
    expect(storedCurrency(storage)).toBe('eur');
  });

  it("doesn't fail when storage refuses", () => {
    const setItem = vi.fn<(key: string, value: string) => void>(() => {
      throw new Error('quota');
    });
    expect(() => saveCurrency('gbp', { setItem })).not.toThrow();
    unblock = blockStorage();
    expect(() => saveCurrency('gbp')).not.toThrow();
  });
});
