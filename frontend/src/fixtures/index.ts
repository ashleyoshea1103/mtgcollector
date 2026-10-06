// Sample data for the component gallery and tests. cards.json holds real Scryfall
// cards (see scripts/fetch-fixtures.mjs) and is frozen: tests must derive expected
// values from these objects rather than hardcode prices.
import { priceFor } from '../lib/price';
import type { Card, CardSummary, CollectionEntry, CollectionStats, CustomGroup, GroupSummary, ValueTotal } from '../types';
import rawCards from './cards.json';

type FixtureCard = 'lightningBolt' | 'ragavan' | 'delver' | 'fireIce' | 'propaganda' | 'llanowarElves';

/** Real cards. fixtures.test.ts checks every one has the full Card shape. */
export const cards = rawCards as unknown as Record<FixtureCard, Card>;

/** A card Scryfall has no prices for. */
export const unpricedCard: Card = {
  ...cards.llanowarElves,
  id: 'unpriced-llanowar-elves',
  prices: { eur: null, eur_foil: null, usd: null, usd_foil: null, usd_etched: null },
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A collection entry priced the way the server prices it. */
export function makeEntry(
  id: number,
  card: CardSummary,
  copy: Partial<Pick<CollectionEntry, 'quantity' | 'finish' | 'condition' | 'language' | 'added_at'>> = {},
): CollectionEntry {
  const { quantity = 1, finish = 'nonfoil', condition = 'NM', language = 'en', added_at = '2026-10-01T12:00:00Z' } = copy;
  const unit = priceFor(card.prices, finish);
  return {
    id,
    card,
    quantity,
    finish,
    condition,
    language,
    added_at,
    unit_price_eur: unit,
    value_eur: unit == null ? null : round2(unit * quantity),
  };
}

/** Totals over some entries, the way the server sums them. */
export function totalOf(entries: CollectionEntry[]): ValueTotal {
  return {
    card_count: entries.reduce((n, e) => n + e.quantity, 0),
    value_eur: round2(entries.reduce((sum, e) => sum + (e.value_eur ?? 0), 0)),
    unpriced_count: entries.filter((e) => e.value_eur == null).reduce((n, e) => n + e.quantity, 0),
  };
}

export function makeGroup(key: string, label: string, entries: CollectionEntry[]): { group: GroupSummary; entries: CollectionEntry[] } {
  return { group: { key, label, entry_count: entries.length, ...totalOf(entries) }, entries };
}

export const entries = {
  bolts: makeEntry(1, cards.lightningBolt, { quantity: 4 }),
  foilRagavan: makeEntry(2, cards.ragavan, { finish: 'foil' }),
  germanDelver: makeEntry(3, cards.delver, { quantity: 2, condition: 'EX', language: 'de' }),
  etchedFireIce: makeEntry(4, cards.fireIce, { finish: 'etched', condition: 'LP' }),
  propaganda: makeEntry(5, cards.propaganda, { finish: 'foil' }),
  unpricedElves: makeEntry(6, unpricedCard, { quantity: 3 }),
};

const allEntries = Object.values(entries);

/** The collection grouped by color: the group headers plus each group's first page of entries. */
export const colorGroups = [
  makeGroup('U', 'Blue', [entries.germanDelver, entries.propaganda]),
  makeGroup('R', 'Red', [entries.bolts, entries.foilRagavan]),
  makeGroup('G', 'Green', [entries.unpricedElves]),
  makeGroup('M', 'Multicolor', [entries.etchedFireIce]),
];

function customGroup(id: number, name: string, kind: CustomGroup['kind'], description: string, members: CollectionEntry[]): CustomGroup {
  return {
    id,
    name,
    kind,
    description,
    preview_images: members.flatMap((e) => (e.card.images ? [e.card.images.small] : [])),
    ...totalOf(members),
  };
}

export const customGroups: CustomGroup[] = [
  customGroup(1, 'Trade binder', 'binder', 'Everything up for trade at the LGS.', [entries.bolts, entries.etchedFireIce, entries.unpricedElves]),
  customGroup(2, 'Izzet Tempo', 'deck', '', [entries.foilRagavan, entries.germanDelver, entries.bolts, entries.etchedFireIce, entries.propaganda]),
  customGroup(3, 'Bulk box', 'box', 'Unsorted.', []),
];

export const stats: CollectionStats = {
  ...totalOf(allEntries),
  unique_cards: allEntries.length,
  value_usd: round2(allEntries.reduce((sum, e) => sum + (priceFor(e.card.prices, e.finish, 'usd') ?? 0) * e.quantity, 0)),
  by_color: Object.fromEntries(colorGroups.map(({ group }) => [group.key, group.card_count])),
  by_rarity: allEntries.reduce<CollectionStats['by_rarity']>((acc, e) => {
    acc[e.card.rarity] = (acc[e.card.rarity] ?? 0) + e.quantity;
    return acc;
  }, {}),
};
