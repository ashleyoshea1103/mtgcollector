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
  /** Only set for cards whose faces are printed on separate sides (transform, modal DFC). */
  images: CardImages | null;
}

export interface Prices {
  eur: number | null;
  eur_foil: number | null;
  usd: number | null;
  usd_foil: number | null;
}

/** One Scryfall printing of a card. */
export interface Card {
  id: string;
  oracle_id: string;
  name: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  rarity: Rarity;
  mana_cost: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  /** Front image; for double-faced cards this is the first face. */
  images: CardImages | null;
  faces: CardFace[] | null;
  oracle_text: string | null;
  prices: Prices;
  cardmarket_url: string | null;
  /** Finishes this printing exists in. */
  finishes: Finish[];
  released_at: string;
}

/** A card the user owns: one printing in one finish, condition and language. */
export interface CollectionEntry {
  id: number;
  card: Card;
  quantity: number;
  finish: Finish;
  condition: Condition;
  language: string;
  added_at: string;
  /** quantity × the EUR price for this finish; null when there's no price. */
  value_eur: number | null;
}

export type GroupBy = 'none' | 'set' | 'color' | 'type' | 'rarity' | 'cmc';

export type SortBy = 'name' | 'price' | 'cmc' | 'added';

/** One section of an auto-grouped collection view (e.g. "Red", "Modern Horizons 2"). */
export interface GroupBucket {
  key: string;
  label: string;
  card_count: number;
  value_eur: number;
  entries: CollectionEntry[];
}

export type CustomGroupKind = 'binder' | 'deck' | 'box' | 'other';

/** A user-created group of cards: a binder, deck, box, etc. */
export interface CustomGroup {
  id: number;
  name: string;
  kind: CustomGroupKind;
  description: string;
  card_count: number;
  value_eur: number;
  preview_images: string[];
}

export interface CollectionStats {
  total_cards: number;
  unique_cards: number;
  value_eur: number;
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
