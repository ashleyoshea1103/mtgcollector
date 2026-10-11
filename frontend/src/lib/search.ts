import type { CardSearch } from '../api/endpoints';
import { MaxSearchLength, MinSearchWord, type Rarity } from '../types';
import { RARITIES } from './labels';

export const EMPTY_SEARCH: CardSearch = { q: '', set: '', type: '', rarity: '', colors: '', extras: false };

/** The colors a search can ask for, in WUBRG order; "C" (colourless) can't be combined with them. */
export const SEARCH_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/** The search in a URL's query. Values the API would refuse are dropped rather than sent. */
export function readSearch(params: URLSearchParams): CardSearch {
  const rarity = params.get('rarity') ?? '';
  const colors = (params.get('colors') ?? '').toUpperCase();
  return {
    q: (params.get('q') ?? '').slice(0, MaxSearchLength),
    set: (params.get('set') ?? '').trim().toLowerCase(),
    type: (params.get('type') ?? '').slice(0, MaxSearchLength),
    rarity: Object.hasOwn(RARITIES, rarity) ? (rarity as Rarity) : '',
    colors: colors === 'C' ? 'C' : SEARCH_COLORS.filter((c) => colors.includes(c)).join(''),
    extras: params.get('extras') === 'true',
  };
}

/** A URL query for a search, with only what's set (and the fields in a fixed order). */
export function writeSearch(s: CardSearch): URLSearchParams {
  const out = new URLSearchParams();
  if (s.q.trim()) out.set('q', s.q.trim());
  if (s.set.trim()) out.set('set', s.set.trim().toLowerCase());
  if (s.type.trim()) out.set('type', s.type.trim());
  if (s.rarity) out.set('rarity', s.rarity);
  if (s.colors) out.set('colors', s.colors);
  if (s.extras) out.set('extras', 'true');
  return out;
}

/**
 * Whether the API will run a search: it needs a word of the name with MinSearchWord letters
 * or digits in a row (what its name index can look up), or a set (whose code must look like one).
 */
export function canSearch(s: CardSearch): boolean {
  if (s.set.trim() !== '') return isSetCode(s.set);
  // Letters and decimal digits, as the server's longestRun counts them (Go's IsLetter, IsDigit).
  const run = new RegExp(`[\\p{L}\\p{Nd}]{${MinSearchWord}}`, 'u');
  return s.q.split(/\s+/).some((word) => run.test(word));
}

/** Whether a set code looks like one (the API refuses anything else): up to 8 letters and digits, e.g. "mh2". */
export function isSetCode(code: string): boolean {
  return /^[a-z0-9]{1,8}$/i.test(code.trim());
}
