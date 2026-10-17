// Fetches Scryfall's card symbols ({G}, {W/U}, {T}…) and writes, for each, the URL of its
// SVG and its name in words ("one green mana") to src/lib/symbology.json, which the app
// uses to show symbols as images and read them out.
//
// The output is committed. Symbols change only when new ones are printed, so rerun this
// then and review the diff. A symbol missing from the file is shown as text instead.
//
// Usage: node scripts/fetch-symbology.mjs
import { writeFile } from 'node:fs/promises';
import { get } from './scryfall.mjs';

/** Only symbols on Scryfall's SVG host, with a plain path, are kept (as in fetch-fixtures.mjs). */
const HOST = 'https://svgs.scryfall.io';
const SAFE_PATH = /^\/card-symbols\/[A-Za-z0-9]+\.svg$/;

const { data, has_more } = await get('/symbology');
if (has_more) throw new Error('symbology: more than one page; paging is not implemented');

const symbols = {};
for (const s of data) {
  const symbol = /^\{([^{}]+)\}$/.exec(s.symbol)?.[1];
  const url = typeof s.svg_uri === 'string' && s.svg_uri.startsWith(HOST) && SAFE_PATH.test(s.svg_uri.slice(HOST.length)) ? s.svg_uri : null;
  const english = typeof s.english === 'string' && s.english.trim() !== '' ? s.english.trim() : null;
  if (!symbol || !url || !english) {
    console.warn(`skipped ${s.symbol} (${s.svg_uri})`);
    continue;
  }
  symbols[symbol] = { svg: url, english };
}
if (Object.keys(symbols).length < 50) throw new Error(`symbology: only ${Object.keys(symbols).length} symbols`);

// Code-point order, not the machine's locale, so the file is the same wherever it's made.
const sorted = Object.fromEntries(Object.entries(symbols).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
await writeFile(new URL('../src/lib/symbology.json', import.meta.url), JSON.stringify(sorted, null, 2) + '\n');
console.log(`${Object.keys(sorted).length} symbols`);
