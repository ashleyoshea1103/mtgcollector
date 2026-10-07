// Sample data for the component gallery and tests. cards.json holds real Scryfall
// cards (see scripts/fetch-fixtures.mjs) and is frozen: tests must derive expected
// values from these objects rather than hardcode prices.
import { DEV_ONLY_MARKER } from '../devOnly';
import { lineValue, priceFor, roundToCents } from '../lib/price';
import type { Card, CardSet, CardSummary, CollectionEntry, CollectionStats, CustomGroup, GroupSummary, ValueTotal } from '../types';
import rawCards from './cards.json';

type FixtureCard = 'lightningBolt' | 'ragavan' | 'delver' | 'fireIce' | 'propaganda' | 'llanowarElves';

/** Real cards. fixtures.test.ts checks every one has the full Card shape. */
export const cards = rawCards as unknown as Record<FixtureCard, Card>;

/** A card Scryfall has no prices for. */
export const unpricedCard: Card = {
  ...cards.llanowarElves,
  id: `${DEV_ONLY_MARKER}:unpriced-llanowar-elves`,
  prices: { eur: null, eur_foil: null, usd: null, usd_foil: null, usd_etched: null },
};

/** A collection entry priced the way the server prices it. */
export function makeEntry(
  id: number,
  card: CardSummary,
  copy: Partial<Pick<CollectionEntry, 'quantity' | 'finish' | 'condition' | 'language' | 'added_at' | 'unit_price_eur'>> = {},
): CollectionEntry {
  const { quantity = 1, finish = 'nonfoil', condition = 'NM', language = 'en', added_at = '2026-10-01T12:00:00Z' } = copy;
  // The server's price, which the client must show as-is. Tests can override it to
  // prove a component shows the server's number rather than working out its own.
  const unit = copy.unit_price_eur !== undefined ? copy.unit_price_eur : priceFor(card.prices, finish);
  return {
    id,
    card,
    quantity,
    finish,
    condition,
    language,
    added_at,
    unit_price_eur: unit,
    value_eur: lineValue(unit, quantity),
  };
}

/** Totals over some entries, the way the server sums them. */
export function totalOf(entries: CollectionEntry[]): ValueTotal {
  return {
    card_count: entries.reduce((n, e) => n + e.quantity, 0),
    value_eur: roundToCents(entries.reduce((sum, e) => sum + (e.value_eur ?? 0), 0)),
    unpriced_count: entries.filter((e) => e.value_eur == null).reduce((n, e) => n + e.quantity, 0),
  };
}

export function makeGroup(
  key: string,
  label: string,
  entries: CollectionEntry[],
  set: CardSet | null = null,
): { group: GroupSummary; entries: CollectionEntry[] } {
  return { group: { key, label, set, entry_count: entries.length, ...totalOf(entries) }, entries };
}

export const entries = {
  bolts: makeEntry(1, cards.lightningBolt, { quantity: 4 }),
  foilRagavan: makeEntry(2, cards.ragavan, { finish: 'foil' }),
  germanDelver: makeEntry(3, cards.delver, { quantity: 2, condition: 'EX', language: 'de' }),
  etchedFireIce: makeEntry(4, cards.fireIce, { finish: 'etched', condition: 'LP' }),
  propaganda: makeEntry(5, cards.propaganda, { finish: 'foil' }),
  unpricedElves: makeEntry(6, unpricedCard, { quantity: 3 }),
};

/** An entry whose server price differs from anything the client could work out from the card's prices. */
export const serverPricedBolts = makeEntry(7, cards.lightningBolt, { quantity: 2, unit_price_eur: 7.77 });

const allEntries = Object.values(entries);

/** The collection grouped by color: the group headers plus each group's first page of entries. */
export const colorGroups = [
  makeGroup('U', 'Blue', [entries.germanDelver, entries.propaganda]),
  makeGroup('R', 'Red', [entries.bolts, entries.foilRagavan]),
  makeGroup('G', 'Green', [entries.unpricedElves]),
  makeGroup('M', 'Multicolor', [entries.etchedFireIce]),
];

/** One group of the collection grouped by set, whose header carries the set. */
export const setGroup = makeGroup(cards.ragavan.set.code, cards.ragavan.set.name, [entries.foilRagavan, entries.etchedFireIce], cards.ragavan.set);

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
  unique_cards: new Set(allEntries.map((e) => e.card.id)).size,
  by_color: Object.fromEntries(colorGroups.map(({ group }) => [group.key, group.card_count])),
  by_rarity: allEntries.reduce<CollectionStats['by_rarity']>((acc, e) => {
    acc[e.card.rarity] = (acc[e.card.rarity] ?? 0) + e.quantity;
    return acc;
  }, {}),
};
