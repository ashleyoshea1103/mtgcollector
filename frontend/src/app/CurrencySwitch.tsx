import type { DisplayCurrency } from '../lib/currency';
import { useMoney } from '../lib/money';
import { SegmentedControl } from '../ui';

const OPTIONS: { value: DisplayCurrency; label: string }[] = [
  { value: 'eur', label: 'EUR' },
  { value: 'gbp', label: 'GBP' },
];

/** Switches prices between euros (Cardmarket's own) and pounds (converted), remembered in this browser. */
export function CurrencySwitch() {
  const money = useMoney();
  return <SegmentedControl label="Currency" className="currency-switch" options={OPTIONS} value={money.chosen} onChange={money.choose} />;
}
