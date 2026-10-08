import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, RARITIES } from '../lib/labels';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokens = read('./tokens.css');
const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

/** A token's #rrggbb value. */
const value = (name: string) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'))![1];

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens', () => {
  it.each(Object.keys(RARITIES))('has a colour for the %s rarity', (rarity) => {
    expect(defined).toContain(`--color-rarity-${rarity}`);
  });

  it.each(Object.keys(COLORS))('has a mana colour for %s', (color) => {
    expect(defined).toContain(`--color-mana-${color.toLowerCase()}`);
  });

  it.each(['color-bg', 'color-text', 'color-focus', 'spacing-4', 'font-body', 'text-md', 'leading-body', 'radius-md', 'shadow-md'])('defines --%s', (name) => {
    expect(defined).toContain(`--${name}`);
  });

  // Rarity colours colour text (set codes, rarity badges): WCAG AA needs 4.5:1.
  it.each(Object.keys(RARITIES))('colours %s text readably on the background', (rarity) => {
    expect(contrast(value(`--color-rarity-${rarity}`), value('--color-bg'))).toBeGreaterThanOrEqual(4.5);
  });

  // A typo'd token is a silent no-op in CSS. Variables with a fallback are set per element
  // by components (e.g. --layout-gap), so only the ones without a fallback must be tokens.
  it.each(['../ui/ui.css', '../index.css'])('%s uses only defined tokens', (path) => {
    const used = [...read(path).matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
