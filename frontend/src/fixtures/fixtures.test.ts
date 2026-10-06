// The fixture cards are cast to Card, so the compiler can't check them.
// These checks catch a regenerated cards.json that has drifted from the type.
import { describe, expect, it } from 'vitest';
import { cards, colorGroups, entries, stats, totalOf } from '.';

const string = expect.any(String);
const priceOrNull = (v: unknown) => v === null || (typeof v === 'number' && v >= 0);

describe('fixture cards', () => {
  it.each(Object.entries(cards))('%s has the full Card shape', (_, card) => {
    expect(card).toMatchObject({
      id: string,
      oracle_id: string,
      name: string,
      set_code: string,
      set_name: string,
      collector_number: string,
      lang: string,
      mana_cost: string,
      cmc: expect.any(Number),
      type_line: string,
      colors: expect.any(Array),
      color_identity: expect.any(Array),
      released_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus']).toContain(card.rarity);
    expect(card.finishes.length).toBeGreaterThan(0);
    expect(Object.keys(card.prices).sort()).toEqual(['eur', 'eur_foil', 'usd', 'usd_etched', 'usd_foil']);
    expect(Object.values(card.prices).every(priceOrNull)).toBe(true);
  });

  it.each(Object.entries(cards))('%s only links to Scryfall images and Cardmarket', (_, card) => {
    const urls = [
      ...Object.values(card.images ?? {}),
      ...(card.faces ?? []).flatMap((f) => Object.values(f.images ?? {})),
    ];
    for (const url of urls) expect(url).toMatch(/^https:\/\/cards\.scryfall\.io\//);
    if (card.cardmarket_url) expect(card.cardmarket_url).toMatch(/^https:\/\/www\.cardmarket\.com\//);
  });
});

describe('fixture totals', () => {
  it('counts unpriced copies separately from the EUR total', () => {
    const total = totalOf([entries.bolts, entries.unpricedElves]);
    expect(total).toEqual({
      card_count: entries.bolts.quantity + entries.unpricedElves.quantity,
      value_eur: entries.bolts.value_eur,
      unpriced_count: entries.unpricedElves.quantity,
    });
  });

  it('groups add up to the whole collection', () => {
    expect(colorGroups.reduce((n, { group }) => n + group.card_count, 0)).toBe(stats.card_count);
  });
});
