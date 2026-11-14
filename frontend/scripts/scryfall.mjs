// What the fetch-*.mjs scripts share: Scryfall's request rules.

// Scryfall requires a User-Agent naming the app, and an Accept header.
export const HEADERS = {
  'User-Agent': 'mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)',
  Accept: 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GETs an API path (e.g. "/cards/m10/146") as JSON, then waits, as Scryfall asks (50–100 ms between requests). */
export async function get(path) {
  const res = await fetch('https://api.scryfall.com' + path, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  await sleep(150);
  return res.json();
}
