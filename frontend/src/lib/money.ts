import { createContext, useContext } from 'react';
import type { DisplayCurrency } from './currency';

/** Whether the GBP rate is known yet: still coming, here, or not to be had (an error, or none). */
export type RateStatus = 'pending' | 'ready' | 'unavailable';

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
  rateStatus: RateStatus;
  choose: (currency: DisplayCurrency) => void;
}

/** Euros, until the app provides more: e.g. a component rendered on its own. */
export const MoneyContext = createContext<Money>({
  chosen: 'eur',
  currency: 'eur',
  gbpPerEur: null,
  rateDate: null,
  rateStatus: 'unavailable',
  choose: () => {},
});

export function useMoney(): Money {
  return useContext(MoneyContext);
}
