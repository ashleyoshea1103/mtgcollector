/**
 * The colour theme: dark (direction A, the design) unless the user picks light. The choice
 * is kept in this browser; the page's <html> carries it as data-theme="light", which the
 * tokens (src/styles/tokens.css) switch on.
 */
export type Theme = 'dark' | 'light';

const KEY = 'mtgcollector-theme';

/** The theme chosen in this browser, or dark. Storage may be unavailable (private mode, blocked). */
export function storedTheme(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Theme {
  try {
    return storage?.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Remembers the theme in this browser, if it can. */
export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, theme);
  } catch {
    // Not remembered: it still applies until the page is closed.
  }
}

/** Shows the page in the theme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}
