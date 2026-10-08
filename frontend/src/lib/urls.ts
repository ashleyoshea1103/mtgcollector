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

/** Where Scryfall serves its SVGs: set symbols and card symbols. */
export const SCRYFALL_SVG_HOST = 'svgs.scryfall.io';

/**
 * The URL a set icon is drawn from as a CSS mask, which browsers fetch with CORS. Scryfall
 * sends its CORS header only to requests that carry an Origin, without Vary, so a copy cached
 * by a plain <img> (e.g. from an older build of the app) would make the mask fail. Its own
 * variant of the URL can't have been cached that way.
 */
export function corsIconUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}cors`;
}
