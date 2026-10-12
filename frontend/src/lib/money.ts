import { createContext, useContext } from 'react';
import type { DisplayCurrency } from './currency';

/**
 * How prices are shown: the currency chosen, and the one in effect (pounds only once there's
 * a rate to convert with), with the rate and its date. Components read it with useMoney; the
 * app provides it (src/app/MoneyProvider.tsx).
 */
export interface Money {
  /** The user's choice. */
  chosen: DisplayCurrency;
  /** What prices are shown in: 'gbp' only when chosen and a GBP rate is known. */
  currency: DisplayCurrency;
  /** Pounds to the euro, and the ECB's date for it (YYYY-MM-DD); null until known. */
  gbpPerEur: number | null;
  rateDate: string | null;
  choose: (currency: DisplayCurrency) => void;
}

/** Euros, until the app provides more: e.g. a component rendered on its own. */
export const MoneyContext = createContext<Money>({
  chosen: 'eur',
  currency: 'eur',
  gbpPerEur: null,
  rateDate: null,
  choose: () => {},
});

export function useMoney(): Money {
  return useContext(MoneyContext);
}
