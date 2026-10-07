import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, RARITIES } from '../lib/labels';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokens = read('./tokens.css');
const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

describe('design tokens', () => {
  it.each(Object.keys(RARITIES))('has a colour for the %s rarity', (rarity) => {
    expect(defined).toContain(`--rarity-${rarity}`);
  });

  it.each(Object.keys(COLORS))('has a mana colour for %s', (color) => {
    expect(defined).toContain(`--mana-${color.toLowerCase()}`);
  });

  it.each(['color-bg', 'color-text', 'color-focus', 'space-4', 'font-body', 'font-size-md', 'radius-md', 'shadow-md'])('defines --%s', (name) => {
    expect(defined).toContain(`--${name}`);
  });

  // A typo'd token is a silent no-op in CSS. Variables with a fallback are set per element
  // by components (e.g. --layout-gap), so only the ones without a fallback must be tokens.
  it.each(['../ui/ui.css', '../index.css'])('%s uses only defined tokens', (path) => {
    const used = [...read(path).matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
