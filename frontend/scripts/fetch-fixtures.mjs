// Fetches a handful of real cards from Scryfall and writes them, mapped to the
// app's Card shape, to src/fixtures/cards.json for the component gallery.
// Usage: node scripts/fetch-fixtures.mjs
import { writeFile } from 'node:fs/promises';

const HEADERS = {
  'User-Agent': 'mtgcollector/0.1 (https://github.com/ashleyoshea1103/mtgcollector)',
  Accept: 'application/json',
};

// key -> Scryfall API path. Each covers a different display case.
const CARDS = {
  lightningBolt: '/cards/named?exact=Lightning+Bolt&set=m10', // basic single-faced common
  ragavan: '/cards/mh2/138', // mythic with a foil price
  delver: '/cards/isd/51', // transforming double-faced card
  fireIce: '/cards/mh2/290', // split card: one image, two faces
  noPrice: '/cards/search?q=' + encodeURIComponent('game:paper -eur>=0 r:rare -is:digital') + '&order=released',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => (s == null ? null : Number(s));
const images = (u) =>
  u ? { small: u.small, normal: u.normal, large: u.large, art_crop: u.art_crop } : null;

function toCard(c) {
  return {
    id: c.id,
    oracle_id: c.oracle_id ?? c.card_faces?.[0]?.oracle_id,
    name: c.name,
    set_code: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    rarity: c.rarity,
    mana_cost: c.mana_cost ?? c.card_faces?.map((f) => f.mana_cost).filter(Boolean).join(' // ') ?? '',
    cmc: c.cmc,
    type_line: c.type_line,
    colors: c.colors ?? [...new Set(c.card_faces?.flatMap((f) => f.colors ?? []) ?? [])],
    color_identity: c.color_identity,
    images: images(c.image_uris ?? c.card_faces?.[0]?.image_uris),
    faces: c.card_faces
      ? c.card_faces.map((f) => ({
          name: f.name,
          mana_cost: f.mana_cost,
          type_line: f.type_line,
          oracle_text: f.oracle_text,
          images: images(f.image_uris),
        }))
      : null,
    oracle_text: c.oracle_text ?? null,
    prices: {
      eur: num(c.prices.eur),
      eur_foil: num(c.prices.eur_foil),
      usd: num(c.prices.usd),
      usd_foil: num(c.prices.usd_foil),
    },
    cardmarket_url: c.purchase_uris?.cardmarket ?? null,
    finishes: c.finishes,
    released_at: c.released_at,
  };
}

const out = {};
for (const [key, path] of Object.entries(CARDS)) {
  const res = await fetch('https://api.scryfall.com' + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const body = await res.json();
  const card = body.object === 'list' ? body.data[0] : body;
  out[key] = toCard(card);
  console.log(`${key}: ${card.name} (${card.set} #${card.collector_number}) eur=${card.prices.eur}`);
  await sleep(150); // Scryfall asks for 50–100 ms between requests
}

await writeFile(new URL('../src/fixtures/cards.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
