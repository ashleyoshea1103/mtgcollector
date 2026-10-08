import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('index.html', () => {
  // Set symbols are drawn from CSS, which can't take referrerPolicy like an <img>, so the
  // page as a whole mustn't tell Scryfall (or anyone) which page loaded an image.
  it('sends no Referer from the page', () => {
    expect(html).toMatch(/<meta name="referrer" content="no-referrer" \/>/);
  });
});
