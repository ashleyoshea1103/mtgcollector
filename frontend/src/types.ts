// Shapes of the objects the API returns. The Go backend's JSON structs mirror these.

export type Finish = 'nonfoil' | 'foil' | 'etched';

/** Cardmarket grading scale, best to worst. */
export type Condition = 'MT' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';

export type ImageSize = 'small' | 'normal' | 'large' | 'art_crop';

export type CardImages = Record<ImageSize, string>;

export interface CardFace {
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text?: string;
  /** Only set for cards whose faces are printed on separate sides (transform, modal DFC, reversible). */
  images: CardImages | null;
}

/**
 * Scryfall's prices. EUR comes from Cardmarket. Scryfall has no EUR etched
 * price, so etched cards are valued at the EUR foil price.
 */
export interface Prices {
  eur: number | null;
  eur_foil: number | null;
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
}

/** The fields list views need (search results, collection entries). */
export interface CardSummary {
  id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: Rarity;
  /** Scryfall language code of this printing, e.g. "en", "ja". */
  lang: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  /** Front image; for double-faced cards this is the first face. */
  images: CardImages | null;
  prices: Prices;
  /** Finishes this printing exists in. */
  finishes: Finish[];
  released_at: string;
}

/** One Scryfall printing with everything the detail view shows. */
export interface Card extends CardSummary {
  faces: CardFace[] | null;
  oracle_text: string | null;
  cardmarket_url: string | null;
}

/** A card the user owns: one printing in one finish, condition and language. */
export interface CollectionEntry {
  id: number;
  card: CardSummary;
  quantity: number;
  finish: Finish;
  condition: Condition;
  language: string;
  added_at: string;
  /** EUR price of one copy in this finish, set by the server; null when there's no price. */
  unit_price_eur: number | null;
  /** quantity × unit_price_eur; null when there's no price. */
  value_eur: number | null;
}

/** A total over many cards, some of which may have no price. */
export interface ValueTotal {
  /** Number of cards (copies) counted. */
  card_count: number;
  /** Sum over the priced cards only. */
  value_eur: number;
  /** How many of the cards had no EUR price and are left out of value_eur. */
  unpriced_count: number;
}

export type GroupBy = 'none' | 'set' | 'color' | 'type' | 'rarity' | 'cmc';

export type SortBy = 'name' | 'price' | 'cmc' | 'added';

/**
 * The header of one auto-group (e.g. "Red", "Modern Horizons 2"). Its entries
 * are fetched separately, a page at a time, as an EntryPage.
 */
export interface GroupSummary extends ValueTotal {
  key: string;
  label: string;
  /** Number of collection entries (distinct printing/finish/condition/language rows). */
  entry_count: number;
}

/** One page of collection entries; pass next_cursor back to get the next page. */
export interface EntryPage {
  entries: CollectionEntry[];
  next_cursor: string | null;
}

export type CustomGroupKind = 'binder' | 'deck' | 'box' | 'other';

/** A user-created group of cards: a binder, deck, box, etc. */
export interface CustomGroup extends ValueTotal {
  id: number;
  name: string;
  kind: CustomGroupKind;
  description: string;
  preview_images: string[];
}

export interface CollectionStats extends ValueTotal {
  unique_cards: number;
  value_usd: number;
  by_color: Record<string, number>;
  by_rarity: Partial<Record<Rarity, number>>;
}

/** What the add-to-collection form submits. */
export interface NewEntry {
  card_id: string;
  quantity: number;
  finish: Finish;
  condition: Condition;
  language: string;
  group_id: number | null;
}
