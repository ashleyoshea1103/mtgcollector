// Checks for URLs the API sends that the page loads. The server only stores URLs that pass
// the same rule (backend/internal/scryfall CheckURL); checking again here means a bug or a
// new endpoint can't make the page load something else.

// After the host: a plain path and query, with nothing that needs escaping.
const SAFE_REST = /^(\/[A-Za-z0-9/._~%-]*)?(\?[A-Za-z0-9=&+%._~-]*)?$/;

/** Whether url is https://host followed by a plain path and query. */
export function isOnHost(url: string, host: string): boolean {
  const prefix = `https://${host}`;
  return url.startsWith(prefix) && SAFE_REST.test(url.slice(prefix.length));
}

export const SET_ICON_HOST = 'svgs.scryfall.io';
