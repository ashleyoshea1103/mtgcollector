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
      set: { code: string, name: string },
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
    for (const finish of card.finishes) expect(['nonfoil', 'foil', 'etched']).toContain(finish);
    expect(card.oracle_text === null || typeof card.oracle_text === 'string').toBe(true);
    const imageSets = [card.images, ...(card.faces ?? []).map((f) => f.images)].filter((i) => i !== null);
    for (const images of imageSets) expect(Object.keys(images).sort()).toEqual(['art_crop', 'large', 'normal', 'small']);
    for (const face of card.faces ?? []) expect(face).toMatchObject({ name: string, mana_cost: string, type_line: string });
    expect(Object.keys(card.prices).sort()).toEqual(['eur', 'eur_foil', 'usd', 'usd_etched', 'usd_foil']);
    expect(Object.values(card.prices).every(priceOrNull)).toBe(true);
  });

  it.each(Object.entries(cards))('%s only links to Scryfall images and icons, and Cardmarket', (_, card) => {
    const urls = [
      ...Object.values(card.images ?? {}),
      ...(card.faces ?? []).flatMap((f) => Object.values(f.images ?? {})),
    ];
    for (const url of urls) expect(url).toMatch(/^https:\/\/cards\.scryfall\.io\//);
    expect(card.set.icon_svg_uri ?? 'https://svgs.scryfall.io/').toMatch(/^https:\/\/svgs\.scryfall\.io\//);
    expect(card.cardmarket_url ?? 'https://www.cardmarket.com/').toMatch(/^https:\/\/www\.cardmarket\.com\//);
  });
});

describe('fixture entries', () => {
  // Checked against the raw Scryfall fields, not priceFor, so a broken
  // "server model" in makeEntry can't hide behind the function it uses.
  it('price each copy at the price for its finish', () => {
    expect(entries.bolts.unit_price_eur).toBe(cards.lightningBolt.prices.eur);
    expect(entries.foilRagavan.unit_price_eur).toBe(cards.ragavan.prices.eur_foil);
    expect(entries.etchedFireIce.unit_price_eur).toBe(cards.fireIce.prices.eur_foil);
    expect(entries.propaganda.unit_price_eur).toBe(cards.propaganda.prices.eur_foil);
    expect(entries.unpricedElves.unit_price_eur).toBeNull();
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
