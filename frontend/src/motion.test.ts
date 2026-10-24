import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** A stylesheet under src, without its comments. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const index = read('./index.css');
const sheets = Object.fromEntries(
  readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.css'))
    .map((file) => file.replaceAll('\\', '/'))
    .map((file) => [file, read(`./${file}`)]),
);

/** The text between a `{` at `open` and its matching `}`. */
function block(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unclosed block');
}

/** A block's declarations, the last of each property winning, as in the browser. */
const declarations = (body: string) =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].replace(/\s+/g, ' ').trim()]));

/** Each @keyframes rule's frames: where they fall ("0%", "60%", "100%") and their declarations. */
function keyframes(css: string) {
  return [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => ({
    name: m[1],
    frames: [...block(css, m.index + m[0].length - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((f) => ({
      at: f[1].split(',').map((s) => s.trim().replace(/^from$/, '0%').replace(/^to$/, '100%')),
      declarations: declarations(f[2] + ';'),
    })),
  }));
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const at = css.search(new RegExp(`(^|\\n)\\s*${selector.replace(/[.:()]/g, '\\$&')}\\s*\\{`));
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return declarations(block(css, css.indexOf('{', at)));
}

/** A value read from index.css, or an error naming what couldn't be read. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`can't read ${what} from index.css`);
  return value;
}

describe('motion', () => {
  it('reads every stylesheet', () => {
    expect(Object.keys(sheets)).toEqual(expect.arrayContaining(['index.css', 'ui/ui.css', 'styles/base.css']));
  });

  // The design brief: only transform and opacity animate, which the browser can do without repainting.
  it.each(Object.entries(sheets))('changes only transform and opacity in the @keyframes of %s', (_, css) => {
    const allowed = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'animation-timing-function'];
    for (const { name, frames } of keyframes(css)) {
      for (const frame of frames) {
        expect(Object.keys(frame.declarations).filter((p) => !allowed.includes(p)), `@keyframes ${name}`).toEqual([]);
      }
    }
  });
});

describe('the foil sheen', () => {
  /** The band's geometry, worked out from the stylesheet. */
  function sheen() {
    // The band is a layer the card's height and wider than it (inset: 0 -X%), holding a diagonal
    // gradient that fades in and out; the layer slides across the card with translateX.
    const band = rule(index, '.card-tile__sheen::before');
    const [, overhangPercent] = must(band.inset?.match(/^0 -(\d+(?:\.\d+)?)%$/), "the band's inset (0 -X%)");
    const [, angle, stops] = must(band.background?.match(/^linear-gradient\( ?(\d+)deg, (.*?) ?\)$/), "the band's linear-gradient(Ndeg, …)");
    // Each stop's position: the percentages left once the colours' own brackets are gone.
    const positions = [...stops.replace(/\([^)]*\)/g, '').matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
    const name = must(band.animation?.match(/^([\w-]+) /)?.[1], "the band's animation name, first in its animation");
    // The browser uses the last @keyframes of a name.
    const frames = must(keyframes(index).filter((k) => k.name === name).at(-1), `@keyframes ${name}`).frames;
    const shiftAt = (at: string) => {
      const transform = must(frames.find((f) => f.at.includes(at))?.declarations.transform, `the transform at ${at} of @keyframes ${name}`);
      return Number(must(transform.match(/^translateX\((-?\d+(?:\.\d+)?)%\)$/), `translateX(N%) at ${at}`)[1]) / 100;
    };

    // Measured in card widths: the card is 1 × 88/63 (its image's proportions), from (0, 0).
    const cardHeight = 88 / 63;
    const overhang = Number(overhangPercent) / 100;
    const width = 1 + 2 * overhang;
    const theta = (Number(angle) * Math.PI) / 180;
    const direction = [Math.sin(theta), -Math.cos(theta)];
    // A CSS gradient line's length: it reaches the box's corners.
    const length = Math.abs(width * direction[0]) + Math.abs(cardHeight * direction[1]);
    const [first, last] = [positions[0], positions.at(-1)!];

    /** How far along the gradient (0 to 1) a point is, with the layer shifted by `shift` of its width. */
    const along = (x: number, y: number, shift: number) => {
      const centre = [0.5 + shift * width, cardHeight / 2];
      return 0.5 + ((x - centre[0]) * direction[0] + (y - centre[1]) * direction[1]) / length;
    };
    /** The corners of a box from `left` to `right`, the card's height. */
    const box = (left: number, right: number) => [left, right].flatMap((x) => [0, cardHeight].map((y) => [x, y] as const));
    const card = box(0, 1);
    /** Where the band is for these points: all before it, all after it, or (null) touching them. */
    const where = (points: (readonly [number, number])[], shift: number) => {
      const at = points.map(([x, y]) => along(x, y, shift));
      return Math.max(...at) <= first ? 'before' : Math.min(...at) >= last ? 'after' : null;
    };
    return { stops, overhang, shiftAt, box, card, where };
  }

  it('fades in from and out to nothing', () => {
    const { stops } = sheen();
    expect(stops).toMatch(/^transparent \S+%, .* transparent \S+%$/);
  });

  it('starts and ends each pass off the card, on opposite sides: the band crosses it, and the loop never jumps', () => {
    const { shiftAt, card, where } = sheen();
    const [start, end] = [where(card, shiftAt('0%')), where(card, shiftAt('100%'))];
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start).not.toBe(end);
  });

  it("never reaches its layer's sides, where the band would be cut off straight as it crosses", () => {
    const { overhang, box, where } = sheen();
    expect(where(box(-overhang, -overhang), 0)).not.toBeNull();
    expect(where(box(1 + overhang, 1 + overhang), 0)).not.toBeNull();
  });

  it('stands still across the middle of the card for those who ask for less motion', () => {
    const { card, where } = sheen();
    const media = index.indexOf('@media (prefers-reduced-motion: reduce)', index.indexOf('.card-tile__sheen'));
    expect(media).toBeGreaterThan(0);
    expect(rule(block(index, index.indexOf('{', media)), '.card-tile__sheen::before')).toEqual({ animation: 'none', transform: 'none' });
    expect(where(card, 0)).toBeNull();
  });

  it("is clipped to the card, while the image (and its button's focus ring) is not", () => {
    const layer = rule(index, '.card-tile__sheen');
    expect(layer).toMatchObject({ position: 'absolute', inset: '0', overflow: 'clip', 'border-radius': 'inherit' });
    expect(Object.keys(rule(index, '.card-tile__media')).filter((p) => /^(overflow|clip-path|contain)/.test(p))).toEqual([]);
  });

  it('lets presses through to the image, as the overlay above it does', () => {
    expect(rule(index, '.card-tile__sheen')['pointer-events']).toBe('none');
    expect(rule(index, '.card-tile__overlay')['pointer-events']).toBe('none');
  });
});
