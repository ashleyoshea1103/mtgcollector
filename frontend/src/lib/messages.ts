import { ApiError, NetworkError } from '../api/client';

/** "the body isn't JSON" → "The body isn't JSON." */
export function sentence(message: string): string {
  const s = message.trim();
  if (s === '') return s;
  const capital = s[0].toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

/**
 * What to tell the user about a failure. The API's messages are safe to show (it never puts
 * internal details in them) and say what to fix; a lost connection gets a plain explanation,
 * and anything else (a bug) a generic one.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return sentence(err.message);
  if (err instanceof NetworkError) return "Couldn't reach the server. Check your connection and try again.";
  return 'Something went wrong. Try again.';
}

/** Whether a failure means there's no such thing: a card, group or entry. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
