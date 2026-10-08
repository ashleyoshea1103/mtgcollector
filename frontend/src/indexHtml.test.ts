import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Comments removed, so a commented-out tag doesn't count.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

describe('index.html', () => {
  // Set symbols are drawn from CSS, which can't take referrerPolicy like an <img>, so the
  // page as a whole mustn't tell Scryfall (or anyone) which page loaded an image. A policy
  // only covers requests made after it, so it must come before anything that fetches.
  it('sends no Referer from the page, from the first request on', () => {
    const meta = html.indexOf('<meta name="referrer" content="no-referrer" />');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(meta).toBeGreaterThan(-1);
    expect(head).toContain('<meta name="referrer" content="no-referrer" />');
    const fetchers = [...html.matchAll(/<(link|script|img|style)\b/g)].map((m) => m.index);
    expect(fetchers.length).toBeGreaterThan(0);
    for (const at of fetchers) expect(meta).toBeLessThan(at);
  });
});
