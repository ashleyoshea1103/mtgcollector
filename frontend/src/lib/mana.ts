const SYMBOL = /\{([^}]+)\}/g;

/**
 * Splits a Scryfall mana cost into symbols, one array per half of a split card.
 * "{2}{R}{W/U}" → [["2", "R", "W/U"]]; "{1}{R} // {1}{U}" → [["1", "R"], ["1", "U"]].
 */
export function parseManaCost(cost: string): string[][] {
  if (!cost) return [];
  return cost.split(' // ').map((half) => [...half.matchAll(SYMBOL)].map((m) => m[1]));
}

const SYMBOL_NAMES: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  C: 'colorless',
  S: 'snow',
  X: 'X',
  Y: 'Y',
  Z: 'Z',
  T: 'tap',
  Q: 'untap',
  E: 'energy',
  P: 'Phyrexian',
  H: 'half',
};

/** One symbol in words: "2" → "2 generic", "W/U" → "white or blue", "B/P" → "Phyrexian black". */
function symbolName(symbol: string): string {
  if (/^\d+$/.test(symbol)) return `${symbol} generic`;
  const parts = symbol.split('/');
  const phyrexian = parts.at(-1) === 'P' && parts.length > 1;
  const words = (phyrexian ? parts.slice(0, -1) : parts).map((p) =>
    Object.hasOwn(SYMBOL_NAMES, p) ? SYMBOL_NAMES[p] : /^\d+$/.test(p) ? `${p} generic` : p,
  );
  return `${phyrexian ? 'Phyrexian ' : ''}${words.join(' or ')}`;
}

/**
 * A mana cost read aloud: "{2}{R}" → "2 generic, red";
 * "{1}{R} // {1}{U}" → "1 generic, red, then 1 generic, blue".
 */
export function describeManaCost(cost: string): string {
  return parseManaCost(cost)
    .map((symbols) => symbols.map(symbolName).join(', '))
    .join(', then ');
}
