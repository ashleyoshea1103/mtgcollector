import { describe, expect, it, vi } from 'vitest';
import { symbolImage } from './mana';

// symbology.json is committed data, but its URLs are still checked like any other, so a bad
// regeneration can't make the page load images from elsewhere.
vi.mock('./symbology.json', () => ({
  default: {
    G: { svg: 'https://svgs.scryfall.io/card-symbols/G.svg', english: 'one green mana' },
    U: { svg: 'https://evil.example/card-symbols/U.svg', english: 'one blue mana' },
    R: { svg: 'https://svgs.scryfall.io/card-symbols/R.svg?x="onerror', english: 'one red mana' },
  },
}));

describe('symbolImage', () => {
  it('only gives images on Scryfall’s host, with plain paths', () => {
    expect(symbolImage('G')).toBe('https://svgs.scryfall.io/card-symbols/G.svg');
    expect(symbolImage('U')).toBeNull();
    expect(symbolImage('R')).toBeNull();
  });
});
