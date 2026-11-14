import { useMoney } from '../lib/money';

interface Props {
  /** What to say while prices are in euros, if anything (e.g. the collection's "Values from Cardmarket, in euros"). */
  euros?: string;
  className?: string;
}

// The copy is English throughout; Intl's short month for September differs between browsers ("Sep", "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09" as "9 Oct 2026". */
function day(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Says once, on a page that shows prices, where pounds come from: Cardmarket's euro prices at
 * the ECB's rate of a given day. Pounds chosen without a rate say why prices are in euros, once
 * it's known there isn't one: nothing is said while the rate is still coming.
 */
export function RateNote({ euros, className }: Props) {
  const money = useMoney();
  let text: string | undefined;
  if (money.currency === 'gbp' && money.gbpPerEur !== null && money.rateDate !== null) {
    text = `Cardmarket's euro prices in pounds, at the ECB rate of ${day(money.rateDate)} (€1 = £${money.gbpPerEur})`;
  } else if (money.chosen === 'gbp') {
    text = money.rateStatus === 'pending' ? undefined : "Pound prices aren't available yet, so these are in euros.";
  } else {
    text = euros;
  }
  if (!text) return null;
  return <p className={['rate-note', className].filter(Boolean).join(' ')}>{text}</p>;
}
