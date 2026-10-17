import { MaxPasswordLength, MinPasswordLength } from '../types';

/**
 * What's wrong with a new password, if anything, by the server's rule: its length in
 * characters once normalised (NFKC), so "é" typed either way counts once.
 */
export function passwordProblem(password: string): string | undefined {
  const n = [...password.normalize('NFKC')].length;
  if (n < MinPasswordLength) return `Use at least ${MinPasswordLength} characters. A few words together work well.`;
  if (n > MaxPasswordLength) return `Use at most ${MaxPasswordLength} characters.`;
  return undefined;
}
