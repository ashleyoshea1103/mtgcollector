import { describe, expect, it } from 'vitest';
import { corsIconUrl, isOnHost, SCRYFALL_SVG_HOST } from './urls';

describe('isOnHost', () => {
  it.each([
    'https://svgs.scryfall.io/sets/mh2.svg?1791172800',
    'https://svgs.scryfall.io/sets/star.svg',
    'https://svgs.scryfall.io',
  ])('accepts %s', (url) => {
    expect(isOnHost(url, SCRYFALL_SVG_HOST)).toBe(true);
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
    expect(isOnHost(url, SCRYFALL_SVG_HOST)).toBe(false);
  });

  // SetSymbol puts the URL in CSS url("…"): nothing that could close or escape it may pass.
  it.each(['"', "'", '(', ')', '\\', '\n', ' ', ';', '<', '>'])('refuses a path or query containing %j', (ch) => {
    expect(isOnHost(`https://svgs.scryfall.io/sets/a${ch}b.svg`, SCRYFALL_SVG_HOST)).toBe(false);
    expect(isOnHost(`https://svgs.scryfall.io/sets/ab.svg?v=1${ch}`, SCRYFALL_SVG_HOST)).toBe(false);
  });
});

describe('corsIconUrl', () => {
  it('gives an icon its own URL for CORS fetches, still on the host', () => {
    expect(corsIconUrl('https://svgs.scryfall.io/sets/mh2.svg?1791172800')).toBe('https://svgs.scryfall.io/sets/mh2.svg?1791172800&cors');
    expect(corsIconUrl('https://svgs.scryfall.io/sets/star.svg')).toBe('https://svgs.scryfall.io/sets/star.svg?cors');
    expect(isOnHost(corsIconUrl('https://svgs.scryfall.io/sets/mh2.svg?1791172800'), SCRYFALL_SVG_HOST)).toBe(true);
  });
});
