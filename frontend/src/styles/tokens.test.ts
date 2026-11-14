import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLORS, RARITIES } from '../lib/labels';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokens = read('./tokens.css');
const defined = new Set([...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));

/** The light theme's overrides: everything after its selector. */
const lightBlock = tokens.slice(tokens.indexOf("[data-theme='light']"));

/** A token's #rrggbb value: the dark theme's (the first), or the light theme's. */
const value = (name: string, theme: 'dark' | 'light' = 'dark') =>
  (theme === 'light' ? lightBlock : tokens).match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'))![1];

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

  // Text needs 4.5:1 against what it sits on (WCAG AA), in both themes: rarity colours colour
  // set symbols and rarity badges; the text colours go on the page and on panels; the accent
  // and danger colours carry text or are text themselves.
  const pairs: [string, string, number][] = [
    ...Object.keys(RARITIES).map((r): [string, string, number] => [`--color-rarity-${r}`, '--color-bg', 4.5]),
    ...['--color-text-strong', '--color-text', '--color-text-secondary', '--color-text-muted'].flatMap((t): [string, string, number][] => [
      [t, '--color-bg', 4.5],
      [t, '--color-surface', 4.5],
      [t, '--color-surface-raised', 4.5],
    ]),
    ['--color-accent-text', '--color-accent', 4.5],
    ['--color-accent', '--color-bg', 4.5],
    ['--color-danger-text', '--color-danger', 4.5],
    ['--color-danger-fg', '--color-bg', 4.5],
    ['--color-danger-fg', '--color-surface-raised', 4.5],
    // The foil chip's text, across its whole gradient.
    ['--color-foil-text', '--color-foil-from', 4.5],
    ['--color-foil-text', '--color-foil-to', 4.5],
    // Non-text marks need 3:1: a focus ring, and the outline that shows where a control is.
    ['--color-focus', '--color-bg', 3],
    ['--color-focus', '--color-surface-raised', 3],
    ['--color-border-control', '--color-bg', 3],
    ['--color-border-control', '--color-surface', 3],
    ['--color-border-control', '--color-surface-raised', 3],
  ];
  describe.each(['dark', 'light'] as const)('the %s theme', (theme) => {
    it.each(pairs)('%s is readable on %s', (fg, bg, ratio) => {
      expect(contrast(value(fg, theme), value(bg, theme))).toBeGreaterThanOrEqual(ratio);
    });
  });

  // A symbol drawn as text is the same dark text on every mana colour. The light theme may
  // override the mana colours, so check against its value where it has one.
  describe.each(['dark', 'light'] as const)('the %s theme', (theme) => {
    const valueOrDark = (name: string) => (theme === 'light' && lightBlock.includes(`${name}:`) ? value(name, 'light') : value(name));
    it.each(Object.keys(COLORS))('mana text is readable on the %s mana colour', (color) => {
      expect(contrast(valueOrDark('--color-mana-text'), valueOrDark(`--color-mana-${color.toLowerCase()}`))).toBeGreaterThanOrEqual(4.5);
    });
  });

  // The quantity badge and a tile's Actions button sit on card art, which can be any colour, so
  // they're one value in both themes. Their translucent backing must keep the text readable even
  // over white art (the worst case for light text).
  it('keeps text on card art readable over any art', () => {
    expect(lightBlock).not.toMatch(/--color-on-image/);
    const [, r, g, b, alpha] = tokens.match(/--color-on-image:\s*rgb\((\d+) (\d+) (\d+) \/ (\d+)%\);/)!.map(Number);
    const overWhite = [r, g, b].map((c) => Math.round((c * alpha + 255 * (100 - alpha)) / 100));
    const backing = `#${overWhite.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    expect(contrast(value('--color-on-image-text'), backing)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives the light theme its own value for every colour it needs', () => {
    for (const name of new Set(pairs.flat().filter((p): p is string => typeof p === 'string'))) {
      expect(lightBlock, name).toMatch(new RegExp(`${name}:`));
    }
  });

  // A typo'd token is a silent no-op in CSS. Variables with a fallback are set per element
  // by components (e.g. --layout-gap), so only the ones without a fallback must be tokens.
  it.each(['../ui/ui.css', '../index.css', './base.css'])('%s uses only defined tokens', (path) => {
    const used = [...read(path).matchAll(/var\((--[\w-]+)\s*\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
