import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRates } from '../api/queries';
import { onCurrencyChanged, saveCurrency, storedCurrency, type DisplayCurrency } from '../lib/currency';
import { MoneyContext, type Money } from '../lib/money';

/**
 * Gives the pages how prices are shown: the currency chosen in this browser (following other
 * tabs), and the GBP rate from the server. Pounds are in effect only once there's a rate.
 */
export function MoneyProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<DisplayCurrency>(() => storedCurrency());
  useEffect(() => onCurrencyChanged(setChosen), []);
  const rates = useRates();
  const gbp = rates.data?.rates.find((r) => r.currency === 'GBP');

  const money = useMemo<Money>(
    () => ({
      chosen,
      currency: chosen === 'gbp' && gbp ? 'gbp' : 'eur',
      gbpPerEur: gbp?.per_eur ?? null,
      rateDate: gbp?.date ?? null,
      choose: (currency) => {
        saveCurrency(currency);
        setChosen(currency);
      },
    }),
    [chosen, gbp],
  );
  return <MoneyContext value={money}>{children}</MoneyContext>;
}
