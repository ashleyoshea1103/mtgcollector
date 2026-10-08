import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('..', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

describe('set icons', () => {
  // Scryfall sends its CORS header only to requests with an Origin, without Vary: a plain
  // <img> of a set icon would leave a cached copy that makes SetSymbol's CORS mask fail, so
  // every set symbol on the page would fall back to its code.
  it('are loaded only by SetSymbol', () => {
    const users = files(src)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('icon_svg_uri'))
      .map((f) => relative(src, f).split(sep).join('/'));
    expect(users.filter((f) => f !== 'components/SetSymbol.tsx' && f !== 'types.ts')).toEqual([]);
  });
});
