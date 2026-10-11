import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyTheme, currentTheme, saveTheme, storedTheme } from './theme';

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

describe('storedTheme', () => {
  it('is dark unless light was chosen', () => {
    expect(storedTheme(memory())).toBe('dark');
    expect(storedTheme(memory({ 'mtgcollector-theme': 'light' }))).toBe('light');
    expect(storedTheme(memory({ 'mtgcollector-theme': 'purple' }))).toBe('dark');
  });

  it('is dark when storage is unavailable', () => {
    unblock = blockStorage();
    expect(storedTheme()).toBe('dark');
    expect(
      storedTheme({
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toBe('dark');
  });
});

describe('saveTheme', () => {
  it('remembers the choice for storedTheme', () => {
    const storage = memory();
    saveTheme('light', storage);
    expect(storedTheme(storage)).toBe('light');
    saveTheme('dark', storage);
    expect(storedTheme(storage)).toBe('dark');
  });

  it("doesn't fail when storage refuses", () => {
    const setItem = vi.fn<(key: string, value: string) => void>(() => {
      throw new Error('quota');
    });
    expect(() => saveTheme('light', { setItem })).not.toThrow();
    unblock = blockStorage();
    expect(() => saveTheme('light')).not.toThrow();
  });
});

const fakeRoot = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

describe('applyTheme', () => {
  it('marks the page light, or removes the mark for dark; currentTheme reads it back', () => {
    const root = fakeRoot();
    expect(currentTheme(root)).toBe('dark');
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    expect(currentTheme(root)).toBe('light');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBeUndefined();
    expect(currentTheme(root)).toBe('dark');
  });
});

// The script index.html runs before the page is drawn: it must read what saveTheme stores.
describe('public/theme-init.js', () => {
  const script = readFileSync(new URL('../../public/theme-init.js', import.meta.url), 'utf8');
  const run = (storage: Pick<Storage, 'getItem'>) => {
    const root = fakeRoot();
    new Function('localStorage', 'document', script)(storage, { documentElement: root });
    return root;
  };

  it('puts the page in the stored theme', () => {
    const storage = memory();
    expect(run(storage).dataset.theme).toBeUndefined();
    saveTheme('light', storage);
    expect(run(storage).dataset.theme).toBe('light');
    saveTheme('dark', storage);
    expect(run(storage).dataset.theme).toBeUndefined();
  });

  it('leaves the page dark when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    expect(run(blocked).dataset.theme).toBeUndefined();
  });
});
