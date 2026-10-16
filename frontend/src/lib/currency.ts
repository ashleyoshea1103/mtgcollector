/**
 * The currency prices are shown in: euros (Cardmarket's own) unless the user picks pounds.
 * The choice is kept in this browser, as the theme is (src/lib/theme.ts); the conversion and
 * the rate are in src/lib/money.ts.
 */
export type DisplayCurrency = 'eur' | 'gbp';

const KEY = 'mtgcollector-currency';

/** This browser's storage. Reading it throws where the user blocks the site's data, so it's read inside the callers' try. */
const local = () => globalThis.localStorage;

/** The currency chosen in this browser, or euros. Storage may be unavailable (private mode, blocked). */
export function storedCurrency(storage?: Pick<Storage, 'getItem'>): DisplayCurrency {
  try {
    return (storage ?? local())?.getItem(KEY) === 'gbp' ? 'gbp' : 'eur';
  } catch {
    return 'eur';
  }
}

/** Remembers the currency in this browser, if it can. */
export function saveCurrency(currency: DisplayCurrency, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? local())?.setItem(KEY, currency);
  } catch {
    // Not remembered: it still applies until the page is closed.
  }
}

/** Calls back with the currency when another tab of the app changes it. Returns the function that stops listening. */
export function onCurrencyChanged(callback: (currency: DisplayCurrency) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) callback(storedCurrency());
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
