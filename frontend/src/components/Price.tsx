import { formatPrice, priceFor, type Currency } from '../lib/price';
import type { Finish, Prices } from '../types';
import { TooltipText } from '../ui';

type Props =
  | { prices: Prices; finish?: Finish; currency?: Currency; value?: never }
  /** An already-computed amount, e.g. a line or group total. */
  | { value: number | null; currency?: Currency; prices?: never; finish?: never };

/** A formatted price, or a dash when Scryfall has no price for it. */
export function Price({ prices, finish, value, currency = 'eur' }: Props) {
  const amount = prices ? priceFor(prices, finish, currency) : value;

  if (amount == null) {
    return (
      <TooltipText className="price price--none" tooltip="No price available">
        —
      </TooltipText>
    );
  }

  return (
    <data className={`price price--${currency}`} value={amount}>
      {formatPrice(amount, currency)}
    </data>
  );
}
