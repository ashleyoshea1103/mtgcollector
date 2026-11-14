import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRates } from '../api/queries';
import { onCurrencyChanged, saveCurrency, storedCurrency, type DisplayCurrency } from '../lib/currency';
import { MoneyContext, type Money, type RateStatus } from '../lib/money';
import type { ExchangeRate } from '../types';

// A rate the app can convert with and date: the server checks the ECB's file, and this keeps a
// broken answer from showing NaN prices or an unreadable date.
const usable = (r: ExchangeRate) => Number.isFinite(r.per_eur) && r.per_eur > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date);

/**
 * Gives the pages how prices are shown: the currency chosen in this browser (following other
 * tabs), and the GBP rate from the server. Pounds are in effect only once there's a rate; until
 * the server has answered, the rate is pending rather than missing.
 */
export function MoneyProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<DisplayCurrency>(() => storedCurrency());
  useEffect(() => onCurrencyChanged(setChosen), []);
  const rates = useRates();
  const gbp = rates.data?.rates?.find((r) => r.currency === 'GBP' && usable(r));
  const rateStatus: RateStatus = gbp ? 'ready' : rates.isPending ? 'pending' : 'unavailable';

  const money = useMemo<Money>(
    () => ({
      chosen,
      currency: chosen === 'gbp' && gbp ? 'gbp' : 'eur',
      gbpPerEur: gbp?.per_eur ?? null,
      rateDate: gbp?.date ?? null,
      rateStatus,
      choose: (currency) => {
        saveCurrency(currency);
        setChosen(currency);
      },
    }),
    [chosen, gbp, rateStatus],
  );
  return <MoneyContext value={money}>{children}</MoneyContext>;
}
