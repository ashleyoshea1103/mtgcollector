import { labelFor, RARITIES } from '../lib/labels';
import type { Rarity } from '../types';
import { Badge, TooltipText } from '../ui';

interface Props {
  rarity: Rarity;
}

/** The rarity's initial ("M"), read out and shown on hover as its name ("Mythic rare"). */
export function RarityBadge({ rarity }: Props) {
  return (
    <Badge className={`rarity-badge rarity-badge--${rarity}`}>
      <TooltipText as="abbr" tooltip={labelFor(RARITIES, rarity)}>
        {rarity.charAt(0).toUpperCase()}
      </TooltipText>
    </Badge>
  );
}
