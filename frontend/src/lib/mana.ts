const SYMBOL = /\{([^}]+)\}/g;

/**
 * Splits a Scryfall mana cost into symbols, one array per half of a split card.
 * "{2}{R}{W/U}" → [["2", "R", "W/U"]]; "{1}{R} // {1}{U}" → [["1", "R"], ["1", "U"]].
 */
export function parseManaCost(cost: string): string[][] {
  if (!cost) return [];
  return cost.split(' // ').map((half) => [...half.matchAll(SYMBOL)].map((m) => m[1]));
}
