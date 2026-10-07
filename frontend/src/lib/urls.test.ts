import { describe, expect, it } from 'vitest';
import { isOnHost, SET_ICON_HOST } from './urls';

describe('isOnHost', () => {
  it.each([
    'https://svgs.scryfall.io/sets/mh2.svg?1791172800',
    'https://svgs.scryfall.io/sets/star.svg',
    'https://svgs.scryfall.io',
  ])('accepts %s', (url) => {
    expect(isOnHost(url, SET_ICON_HOST)).toBe(true);
  });

  it.each([
    'http://svgs.scryfall.io/sets/mh2.svg',
    'https://svgs.scryfall.io.evil.example/sets/mh2.svg',
    'https://svgs.scryfall.io@evil.example/x.svg',
    'https://svgs.scryfall.io:444/x.svg',
    "https://svgs.scryfall.io/x'),url('https://evil.example/",
    'https://svgs.scryfall.io/a b.svg',
    'https://svgs.scryfall.io/x.svg#frag',
    'data:image/svg+xml,<svg onload="alert(1)"/>',
    'javascript:alert(1)//https://svgs.scryfall.io/',
    '',
  ])('refuses %s', (url) => {
    expect(isOnHost(url, SET_ICON_HOST)).toBe(false);
  });
});
