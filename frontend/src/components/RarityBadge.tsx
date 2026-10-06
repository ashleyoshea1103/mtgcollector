import { labelFor, RARITIES } from '../lib/labels';
import type { Rarity } from '../types';

interface Props {
  rarity: Rarity;
}

export function RarityBadge({ rarity }: Props) {
  return (
    <abbr className={`rarity-badge rarity-badge--${rarity}`} title={labelFor(RARITIES, rarity)}>
      {rarity.charAt(0).toUpperCase()}
    </abbr>
  );
}
