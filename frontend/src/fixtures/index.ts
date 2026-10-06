// Sample data for the component gallery. cards.json holds real Scryfall cards
// (regenerate with `node scripts/fetch-fixtures.mjs`); everything else is built from them.
import { priceFor } from '../lib/price';
import type { Card, CollectionEntry, CollectionStats, Condition, CustomGroup, Finish, GroupBucket } from '../types';
import rawCards from './cards.json';

type FixtureCard = 'lightningBolt' | 'ragavan' | 'delver' | 'fireIce' | 'noPrice';

export const cards = rawCards as unknown as Record<FixtureCard, Card>;

let nextId = 1;
function entry(card: Card, quantity: number, finish: Finish = 'nonfoil', condition: Condition = 'NM', language = 'en'): CollectionEntry {
  const unit = priceFor(card.prices, finish);
  return {
    id: nextId++,
    card,
    quantity,
    finish,
    condition,
    language,
    added_at: '2026-10-01T12:00:00Z',
    value_eur: unit == null ? null : Math.round(unit * quantity * 100) / 100,
  };
}

export const entries = {
  bolts: entry(cards.lightningBolt, 4),
  foilRagavan: entry(cards.ragavan, 1, 'foil', 'NM'),
  germanDelver: entry(cards.delver, 2, 'nonfoil', 'EX', 'de'),
  etchedFireIce: entry(cards.fireIce, 1, 'etched', 'LP'),
  farseek: entry(cards.noPrice, 1),
};

const allEntries = Object.values(entries);

function bucket(key: string, label: string, members: CollectionEntry[]): GroupBucket {
  return {
    key,
    label,
    card_count: members.reduce((n, e) => n + e.quantity, 0),
    value_eur: Math.round(members.reduce((sum, e) => sum + (e.value_eur ?? 0), 0) * 100) / 100,
    entries: members,
  };
}

/** The collection grouped by color, as `GET /api/collection?group_by=color` will return it. */
export const colorBuckets: GroupBucket[] = [
  bucket('U', 'Blue', [entries.germanDelver]),
  bucket('R', 'Red', [entries.bolts, entries.foilRagavan]),
  bucket('G', 'Green', [entries.farseek]),
  bucket('M', 'Multicolor', [entries.etchedFireIce]),
];

const img = (c: Card) => c.images!.small;

export const customGroups: CustomGroup[] = [
  {
    id: 1,
    name: 'Trade binder',
    kind: 'binder',
    description: 'Everything up for trade at the LGS.',
    card_count: 5,
    value_eur: bucket('', '', [entries.bolts, entries.etchedFireIce]).value_eur,
    preview_images: [img(cards.lightningBolt), img(cards.fireIce)],
  },
  {
    id: 2,
    name: 'Izzet Tempo',
    kind: 'deck',
    description: '',
    card_count: 8,
    value_eur: bucket('', '', [entries.bolts, entries.foilRagavan, entries.germanDelver, entries.etchedFireIce]).value_eur,
    preview_images: [img(cards.ragavan), img(cards.delver), img(cards.lightningBolt), img(cards.fireIce)],
  },
  {
    id: 3,
    name: 'Bulk box',
    kind: 'box',
    description: 'Unsorted.',
    card_count: 0,
    value_eur: 0,
    preview_images: [],
  },
];

export const stats: CollectionStats = {
  total_cards: allEntries.reduce((n, e) => n + e.quantity, 0),
  unique_cards: allEntries.length,
  value_eur: bucket('', '', allEntries).value_eur,
  value_usd:
    Math.round(allEntries.reduce((sum, e) => sum + (priceFor(e.card.prices, e.finish, 'usd') ?? 0) * e.quantity, 0) * 100) / 100,
  by_color: Object.fromEntries(colorBuckets.map((b) => [b.key, b.card_count])),
  by_rarity: allEntries.reduce<CollectionStats['by_rarity']>((acc, e) => {
    acc[e.card.rarity] = (acc[e.card.rarity] ?? 0) + e.quantity;
    return acc;
  }, {}),
};
