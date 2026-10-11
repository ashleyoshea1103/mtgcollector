import { describe, expect, it } from 'vitest';
import { parseId } from './ids';

describe('parseId', () => {
  it('reads positive whole numbers', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('42')).toBe(42);
    expect(parseId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([undefined, '', '0', '-1', '01', '1.5', '1e3', ' 1', '0x10', 'abc', '9007199254740993', '12345678901234567'])('refuses %j', (text) => {
    expect(parseId(text)).toBeNull();
  });
});
