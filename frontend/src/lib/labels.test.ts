import { describe, expect, it } from 'vitest';
import { CONDITIONS, labelFor, LANGUAGES } from './labels';

describe('labelFor', () => {
  it('returns the label for a known code', () => {
    expect(labelFor(CONDITIONS, 'LP')).toBe('Light Played');
    expect(labelFor(LANGUAGES, 'ph')).toBe('Phyrexian');
  });

  it('falls back to the code itself for unknown codes', () => {
    expect(labelFor(LANGUAGES, 'xx')).toBe('xx');
  });

  it('never returns inherited object properties', () => {
    for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(labelFor(LANGUAGES, code)).toBe(code);
    }
  });
});
