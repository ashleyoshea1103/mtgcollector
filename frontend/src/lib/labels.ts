import type { Condition, CustomGroupKind, Finish, Rarity } from '../types';

export const CONDITIONS: Record<Condition, string> = {
  MT: 'Mint',
  NM: 'Near Mint',
  EX: 'Excellent',
  GD: 'Good',
  LP: 'Light Played',
  PL: 'Played',
  PO: 'Poor',
};

export const FINISHES: Record<Finish, string> = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched foil',
};

export const RARITIES: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  mythic: 'Mythic rare',
  special: 'Special',
  bonus: 'Bonus',
};

export const GROUP_KINDS: Record<CustomGroupKind, string> = {
  binder: 'Binder',
  deck: 'Deck',
  box: 'Box',
  other: 'Other',
};

export const COLORS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless',
  M: 'Multicolor',
};

/** Every language code Scryfall uses (https://scryfall.com/docs/api/languages). */
export const LANGUAGES: Record<string, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  zhs: 'Simplified Chinese',
  zht: 'Traditional Chinese',
  he: 'Hebrew',
  la: 'Latin',
  grc: 'Ancient Greek',
  ar: 'Arabic',
  sa: 'Sanskrit',
  ph: 'Phyrexian',
  qya: 'Quenya',
};
