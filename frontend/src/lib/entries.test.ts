import { describe, expect, it } from 'vitest';
import { entries } from '../fixtures';
import { describeEntry, entryChange } from './entries';

const bolt = entries.bolts;
const same = { quantity: bolt.quantity, finish: bolt.finish, condition: bolt.condition, language: bolt.language };

describe('entryChange', () => {
  it('is empty when nothing changed', () => {
    expect(entryChange(bolt, same)).toEqual({});
  });

  it('has each changed field, and only those', () => {
    expect(entryChange(bolt, { ...same, quantity: bolt.quantity + 1 })).toEqual({ quantity: bolt.quantity + 1 });
    expect(entryChange(bolt, { ...same, finish: 'foil' })).toEqual({ finish: 'foil' });
    expect(entryChange(bolt, { ...same, condition: 'PO' })).toEqual({ condition: 'PO' });
    expect(entryChange(bolt, { ...same, language: 'ja' })).toEqual({ language: 'ja' });
    expect(entryChange(bolt, { quantity: 1, finish: 'foil', condition: 'PO', language: 'ja' })).toEqual({
      quantity: 1,
      finish: 'foil',
      condition: 'PO',
      language: 'ja',
    });
  });
});

describe('describeEntry', () => {
  it('names the copies: how many, the card, and which copies', () => {
    expect(describeEntry(entries.germanDelver)).toBe(`2 × ${entries.germanDelver.card.name} (Non-foil, Excellent, German)`);
    expect(describeEntry(entries.foilRagavan)).toBe(`1 × ${entries.foilRagavan.card.name} (Foil, Near Mint, English)`);
  });
});
