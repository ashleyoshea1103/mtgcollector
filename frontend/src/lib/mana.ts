import symbology from './symbology.json';
import { isOnHost, SYMBOL_HOST } from './urls';

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
export function describeManaSymbol(symbol: string): string {
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
    .map((symbols) => symbols.map(describeManaSymbol).join(', '))
    .join(', then ');
}

const SYMBOL_IMAGES: Record<string, string> = symbology;

/**
 * Scryfall's image for a symbol ("G", "W/U", "T"), from src/lib/symbology.json, or null
 * for one it hasn't got: show the symbol as text then.
 */
export function symbolImage(symbol: string): string | null {
  const url = Object.hasOwn(SYMBOL_IMAGES, symbol) ? SYMBOL_IMAGES[symbol] : null;
  return url !== null && isOnHost(url, SYMBOL_HOST) ? url : null;
}

/** A piece of rules text: plain text, or one symbol. */
export type TextPart = { text: string } | { symbol: string };

/** Splits rules text around its symbols: "{T}: Add {G}." → symbol T, text ": Add ", symbol G, text ".". */
export function splitSymbols(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(SYMBOL)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ symbol: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
