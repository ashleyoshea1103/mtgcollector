import { describe, expect, it, vi } from 'vitest';
import { applyTheme, saveTheme, storedTheme } from './theme';

const memory = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
};

describe('storedTheme', () => {
  it('is dark unless light was chosen', () => {
    expect(storedTheme(memory())).toBe('dark');
    expect(storedTheme(memory({ 'mtgcollector-theme': 'light' }))).toBe('light');
    expect(storedTheme(memory({ 'mtgcollector-theme': 'purple' }))).toBe('dark');
  });

  it('is dark when storage is unavailable', () => {
    expect(storedTheme(undefined)).toBe('dark');
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
    expect(() => saveTheme('light', undefined)).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('marks the page light, or removes the mark for dark', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    applyTheme('dark', root);
    expect(root.dataset.theme).toBeUndefined();
  });
});
