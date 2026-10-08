// Fetches Scryfall's card symbols ({G}, {W/U}, {T}…) and writes, for each, the URL of its
// SVG to src/lib/symbology.json, which the app uses to show symbols as images.
//
// The output is committed. Symbols change only when new ones are printed, so rerun this
// then and review the diff. A symbol missing from the file is shown as text instead.
//
// Usage: node scripts/fetch-symbology.mjs
import { writeFile } from 'node:fs/promises';

const HEADERS = {
  'User-Agent': 'mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)',
  Accept: 'application/json',
};

/** Only symbols on Scryfall's SVG host, with a plain path, are kept (as in fetch-fixtures.mjs). */
const HOST = 'https://svgs.scryfall.io';
const SAFE_PATH = /^\/card-symbols\/[A-Za-z0-9]+\.svg$/;

const res = await fetch('https://api.scryfall.com/symbology', { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
if (!res.ok) throw new Error(`symbology: HTTP ${res.status}`);
const { data, has_more } = await res.json();
if (has_more) throw new Error('symbology: more than one page; paging is not implemented');

const symbols = {};
for (const s of data) {
  const symbol = /^\{([^{}]+)\}$/.exec(s.symbol)?.[1];
  const url = typeof s.svg_uri === 'string' && s.svg_uri.startsWith(HOST) && SAFE_PATH.test(s.svg_uri.slice(HOST.length)) ? s.svg_uri : null;
  if (!symbol || !url) {
    console.warn(`skipped ${s.symbol} (${s.svg_uri})`);
    continue;
  }
  symbols[symbol] = url;
}
if (Object.keys(symbols).length < 50) throw new Error(`symbology: only ${Object.keys(symbols).length} symbols`);

const sorted = Object.fromEntries(Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL('../src/lib/symbology.json', import.meta.url), JSON.stringify(sorted, null, 2) + '\n');
console.log(`${Object.keys(sorted).length} symbols`);
