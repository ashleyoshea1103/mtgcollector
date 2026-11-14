import { describe, expect, it } from 'vitest';
import { cardPath, groupPath } from './paths';

describe('paths', () => {
  it('builds card and group pages', () => {
    expect(cardPath('0b8fe8b3-0000-4000-8000-000000000000')).toBe('/cards/0b8fe8b3-0000-4000-8000-000000000000');
    expect(groupPath(12)).toBe('/groups/12');
  });

  it('encodes an id that could change the path', () => {
    expect(cardPath('../groups?x#y')).toBe('/cards/..%2Fgroups%3Fx%23y');
  });
});
