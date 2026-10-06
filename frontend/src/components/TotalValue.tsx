import type { ValueTotal } from '../types';
import { Price } from './Price';

interface Props {
  total: ValueTotal;
}

/**
 * The EUR value of a set of cards. Says how many cards had no price, and shows
 * a dash rather than €0.00 when none of them did.
 */
export function TotalValue({ total }: Props) {
  const nonePriced = total.unpriced_count > 0 && total.unpriced_count >= total.card_count;
  return (
    <span className={`total-value${total.unpriced_count > 0 ? ' total-value--partial' : ''}`}>
      <Price value={nonePriced ? null : total.value_eur} />
      {total.unpriced_count > 0 && !nonePriced && (
        <span className="total-value__unpriced"> (+{total.unpriced_count} unpriced)</span>
      )}
    </span>
  );
}
