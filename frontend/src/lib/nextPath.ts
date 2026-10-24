// Any origin will do as the base: only whether the result stays on it matters.
const BASE = 'http://app.invalid';

/**
 * Where to go after logging in: the ?next= path the login page was sent with, if it's a page
 * of this app, else fallback. It's judged by the URL it resolves to, as a browser would
 * resolve it, so no spelling of another site gets through: "//evil.example", "https://…",
 * "/\evil", or dot segments that collapse to "//evil.example" ("/.//evil.example").
 */
export function nextPath(next: string | null, fallback: string): string {
  if (!next || !next.startsWith('/')) return fallback;
  // Control characters and backslashes have no place in our paths; browsers treat "\" as "/".
  if ([...next].some((ch) => ch < ' ' || ch === '\u007f' || ch === '\\')) return fallback;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;
  // The login and sign-up pages themselves would just send the user back here.
  if (/^\/(login|signup)(?:\/|$)/i.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}

/** The login page's URL for coming back to path (a pathname with its search) afterwards. */
export function loginUrl(path: string): string {
  return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
}
