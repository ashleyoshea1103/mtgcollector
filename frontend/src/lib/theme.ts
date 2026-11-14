/**
 * The colour theme: dark (direction A, the design) unless the user picks light. The choice
 * is kept in this browser; the page's <html> carries it as data-theme="light", which the
 * tokens (src/styles/tokens.css) switch on.
 */
export type Theme = 'dark' | 'light';

const KEY = 'mtgcollector-theme';

/** This browser's storage. Reading it throws where the user blocks the site's data, so it's read inside the callers' try. */
const local = () => globalThis.localStorage;

/** The theme chosen in this browser, or dark. Storage may be unavailable (private mode, blocked). */
export function storedTheme(storage?: Pick<Storage, 'getItem'>): Theme {
  try {
    return (storage ?? local())?.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Remembers the theme in this browser, if it can. */
export function saveTheme(theme: Theme, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? local())?.setItem(KEY, theme);
  } catch {
    // Not remembered: it still applies until the page is closed.
  }
}

/** The theme the page is in (set before it's drawn, by public/theme-init.js, from the stored one). */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  return root.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Shows the page in the theme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}

/**
 * Calls back with the theme when another tab of the app changes it, so every open tab
 * follows. Returns the function that stops listening.
 */
export function onThemeChanged(callback: (theme: Theme) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) callback(storedTheme());
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
