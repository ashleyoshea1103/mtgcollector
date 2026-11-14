import { useMoney } from '../lib/money';
import { formatPrice, priceFor, toPounds, type Currency } from '../lib/price';
import type { Finish, Prices } from '../types';
import { TooltipText, VisuallyHidden } from '../ui';

interface SharedProps {
  currency?: Currency;
  /**
   * A price for one copy: " each" follows it. Among pounds (a converted price, or the dash in
   * its place) only screen readers get it ("about £1.79 each"); "≈£1.79" shows.
   */
  each?: boolean;
}

type Props =
  | (SharedProps & { prices: Prices; finish?: Finish; value?: never })
  /** An already-computed amount, e.g. a line or group total. */
  | (SharedProps & { value: number | null; prices?: never; finish?: never });

/**
 * A formatted price, or a dash when Scryfall has no price for it. A euro price shows in
 * pounds when they're in effect (useMoney): converted at the day's rate, so marked "≈" and
 * read out as "about".
 */
export function Price({ prices, finish, value, currency = 'eur', each = false }: Props) {
  const money = useMoney();
  const amount = prices ? priceFor(prices, finish, currency) : value;
  const gbpPerEur = currency === 'eur' && money.currency === 'gbp' ? money.gbpPerEur : null;
  // Among pounds (a converted price, or the dash beside them), "each" is for screen readers only.
  const perCopy = each && (gbpPerEur !== null ? <VisuallyHidden> each</VisuallyHidden> : ' each');

  if (amount == null) {
    return (
      <>
        <TooltipText className="price price--none" tooltip="No price available">
          —
        </TooltipText>
        {perCopy}
      </>
    );
  }

  if (gbpPerEur !== null) {
    const pounds = toPounds(amount, gbpPerEur);
    return (
      <>
        <data className="price price--gbp" value={pounds}>
          <span aria-hidden="true">≈</span>
          <VisuallyHidden>about </VisuallyHidden>
          {formatPrice(pounds, 'gbp')}
        </data>
        {perCopy}
      </>
    );
  }

  return (
    <>
      <data className={`price price--${currency}`} value={amount}>
        {formatPrice(amount, currency)}
      </data>
      {perCopy}
    </>
  );
}
