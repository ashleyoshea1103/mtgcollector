/**
 * Where to go after logging in: the ?next= path the login page was sent with, if it's a page
 * of this app, else fallback. Anything else is ignored, so a link to the login page can't
 * send someone to another site after they sign in ("//evil.example", "https://…", "/\evil").
 */
export function nextPath(next: string | null, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  // Control characters and backslashes have no place in our paths; browsers treat "\" as "/".
  if ([...next].some((ch) => ch < ' ' || ch === '\u007f' || ch === '\\')) return fallback;
  // The login and sign-up pages themselves would just send the user back here.
  if (/^\/(login|signup)(?:[/?#]|$)/.test(next)) return fallback;
  return next;
}

/** The login page's URL for coming back to path (a pathname with its search) afterwards. */
export function loginUrl(path: string): string {
  return path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`;
}
