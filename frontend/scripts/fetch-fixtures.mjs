// Fetches a fixed set of real cards from Scryfall and writes them, mapped to the
// app's Card shape, to src/fixtures/cards.json for the gallery and tests.
//
// The output is committed and treated as frozen: tests derive their expected
// values from it, so regenerating it (prices change daily) must not break them.
// Review the diff before committing a regenerated file.
//
// The mapping here is the same one the Go bulk import must apply.
//
// Usage: node scripts/fetch-fixtures.mjs
import { writeFile } from 'node:fs/promises';

const HEADERS = {
  'User-Agent': 'mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)',
  Accept: 'application/json',
};

// key -> Scryfall API path for one exact printing. Each covers a different display case.
const CARDS = {
  lightningBolt: '/cards/m10/146', // single-faced common
  ragavan: '/cards/mh2/138', // mythic with a foil price
  delver: '/cards/isd/51', // transforming double-faced card: an image per face
  fireIce: '/cards/mh2/290', // split card: one image, two faces, etched finish
  propaganda: '/cards/sld/381', // reversible card: foil-only, faces share a name, no top-level type/cost
  llanowarElves: '/cards/m19/314', // plain card; the fixtures also derive an unpriced copy from it
};

const IMAGE_HOST = 'https://cards.scryfall.io/';
const SET_ICON_HOST = 'https://svgs.scryfall.io/';
const CARDMARKET_HOST = 'https://www.cardmarket.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => (s == null ? null : Number(s));

/**
 * Only trust URLs on the hosts we expect, with a plain path and query; anything else is
 * dropped. The same rule as the importer's (backend/internal/scryfall CheckURL).
 */
const SAFE_REST = /^(\/[A-Za-z0-9/._~%-]*)?(\?[A-Za-z0-9=&+%._~-]*)?$/;
const onHost = (url, host) =>
  typeof url === 'string' && url.startsWith(host.slice(0, -1)) && SAFE_REST.test(url.slice(host.length - 1)) ? url : null;

function images(u) {
  if (!u) return null;
  const sizes = { small: u.small, normal: u.normal, large: u.large, art_crop: u.art_crop };
  return Object.values(sizes).every((url) => onHost(url, IMAGE_HOST)) ? sizes : null;
}

/** Each different non-empty value of a face field, in order, joined as Scryfall writes them ("A // B"). */
const joinDistinct = (faces, field) => [...new Set(faces.map((f) => f[field]).filter(Boolean))].join(' // ');

/** The app's CardSet for a Scryfall set object. */
const toSet = (s) => ({ code: s.code, name: s.name, icon_svg_uri: onHost(s.icon_svg_uri, SET_ICON_HOST) });

function toCard(c, set) {
  const faces = c.card_faces ?? null;
  const front = faces?.[0];
  // Reversible cards put everything on the faces, and their top-level name repeats faces
  // ("Propaganda // Propaganda"); other multi-face layouts (split, transform…) describe the
  // whole card at the top level. For reversible cards, each distinct face name, cost and
  // type is taken once, which gives the name other printings of the card have.
  const reversible = c.layout === 'reversible_card' && front;

  const card = {
    id: c.id,
    oracle_id: c.oracle_id ?? front?.oracle_id,
    name: reversible ? joinDistinct(faces, 'name') : c.name,
    set,
    collector_number: c.collector_number,
    rarity: c.rarity,
    lang: c.lang,
    mana_cost: c.mana_cost ?? (reversible ? joinDistinct(faces, 'mana_cost') : (faces?.map((f) => f.mana_cost).filter(Boolean).join(' // ') ?? '')),
    cmc: c.cmc ?? front?.cmc,
    type_line: c.type_line ?? (reversible ? joinDistinct(faces, 'type_line') : front?.type_line),
    colors: c.colors ?? [...new Set(faces?.flatMap((f) => f.colors ?? []) ?? [])],
    color_identity: c.color_identity,
    images: images(c.image_uris ?? front?.image_uris),
    prices: {
      eur: num(c.prices.eur),
      eur_foil: num(c.prices.eur_foil),
      usd: num(c.prices.usd),
      usd_foil: num(c.prices.usd_foil),
      usd_etched: num(c.prices.usd_etched),
    },
    finishes: c.finishes,
    released_at: c.released_at,
    faces: faces
      ? faces.map((f) => ({
          name: f.name,
          mana_cost: f.mana_cost ?? '',
          type_line: f.type_line ?? '',
          oracle_text: f.oracle_text,
          images: images(f.image_uris),
        }))
      : null,
    oracle_text: c.oracle_text ?? null,
    cardmarket_url: onHost(c.purchase_uris?.cardmarket, CARDMARKET_HOST),
  };

  for (const field of ['oracle_id', 'name', 'rarity', 'lang', 'cmc', 'type_line', 'colors', 'finishes']) {
    if (card[field] === undefined) throw new Error(`${c.set}/${c.collector_number}: missing ${field}`);
  }
  return card;
}

async function get(path) {
  const res = await fetch('https://api.scryfall.com' + path, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  await sleep(150); // Scryfall asks for 50–100 ms between requests
  return res.json();
}

const out = {};
const sets = {};
for (const [key, path] of Object.entries(CARDS)) {
  const card = await get(path);
  sets[card.set] ??= toSet(await get(`/sets/${card.set}`));
  out[key] = toCard(card, sets[card.set]);
  console.log(`${key}: ${out[key].name} (${out[key].set.code} #${out[key].collector_number})`);
}

await writeFile(new URL('../src/fixtures/cards.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
