import { describe, expect, it } from 'vitest';
import { MaxPasswordLength, MinPasswordLength } from '../types';
import { passwordProblem } from './auth';

describe('passwordProblem', () => {
  it('allows the shortest and longest passwords', () => {
    expect(passwordProblem('x'.repeat(MinPasswordLength))).toBeUndefined();
    expect(passwordProblem('x'.repeat(MaxPasswordLength))).toBeUndefined();
  });

  it('refuses shorter and longer ones', () => {
    expect(passwordProblem('x'.repeat(MinPasswordLength - 1))).toBe(`Use at least ${MinPasswordLength} characters. A few words together work well.`);
    expect(passwordProblem('x'.repeat(MaxPasswordLength + 1))).toBe(`Use at most ${MaxPasswordLength} characters.`);
  });

  it('counts characters as the server does, after normalising', () => {
    // 15 accented letters typed as letter + accent: 30 code points, 15 characters.
    expect(passwordProblem('é'.repeat(MinPasswordLength))).toBeUndefined();
    expect(passwordProblem('é'.repeat(MinPasswordLength - 1))).toBeDefined();
    // Emoji are one character each, though two UTF-16 units.
    expect(passwordProblem('\u{1F0CF}'.repeat(MinPasswordLength - 1))).toBeDefined();
  });
});
