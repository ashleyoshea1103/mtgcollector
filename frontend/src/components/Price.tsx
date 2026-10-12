import { useMoney } from '../lib/money';
import { formatPrice, priceFor, toPounds, type Currency } from '../lib/price';
import type { Finish, Prices } from '../types';
import { TooltipText, VisuallyHidden } from '../ui';

type Props =
  | { prices: Prices; finish?: Finish; currency?: Currency; value?: never }
  /** An already-computed amount, e.g. a line or group total. */
  | { value: number | null; currency?: Currency; prices?: never; finish?: never };

/**
 * A formatted price, or a dash when Scryfall has no price for it. A euro price shows in
 * pounds when they're in effect (useMoney): converted at the day's rate, so marked "≈" and
 * read out as "about".
 */
export function Price({ prices, finish, value, currency = 'eur' }: Props) {
  const money = useMoney();
  const amount = prices ? priceFor(prices, finish, currency) : value;

  if (amount == null) {
    return (
      <TooltipText className="price price--none" tooltip="No price available">
        —
      </TooltipText>
    );
  }

  if (currency === 'eur' && money.currency === 'gbp' && money.gbpPerEur !== null) {
    const pounds = toPounds(amount, money.gbpPerEur);
    return (
      <data className="price price--gbp" value={pounds}>
        <span aria-hidden="true">≈</span>
        <VisuallyHidden>about </VisuallyHidden>
        {formatPrice(pounds, 'gbp')}
      </data>
    );
  }

  return (
    <data className={`price price--${currency}`} value={amount}>
      {formatPrice(amount, currency)}
    </data>
  );
}
