import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** A stylesheet without its comments. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const index = read('./index.css');
const sheets = { 'index.css': index, 'ui/ui.css': read('./ui/ui.css') };

/** The text between a `{` at `open` and its matching `}`. */
function block(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unclosed block');
}

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

describe('motion', () => {
  // The design brief: only transform and opacity animate, which the browser can do without repainting.
  it.each(Object.entries(sheets))('animates only transform and opacity in %s', (_, css) => {
    for (const { name, frames } of keyframes(css)) {
      for (const frame of frames) {
        const animated = Object.keys(frame.declarations).filter((p) => p !== 'animation-timing-function');
        expect(animated.filter((p) => p !== 'transform' && p !== 'opacity'), `@keyframes ${name}`).toEqual([]);
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
    const [, sidePercent] = band.inset.match(/^0 -(\d+(?:\.\d+)?)%$/)!;
    const [, angle, stops] = band.background.match(/^linear-gradient\( ?(\d+)deg, (.*?) ?\)$/)!;
    // Each stop's position: the percentages left once the colours' own brackets are gone.
    const positions = [...stops.replace(/\([^)]*\)/g, '').matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]) / 100);
    const frames = keyframes(index).find((k) => k.name === band.animation.split(' ')[0])!.frames;
    const shiftAt = (at: string) => {
      const transform = frames.find((f) => f.at.includes(at))!.declarations.transform;
      return Number(transform.match(/^translateX\((-?\d+(?:\.\d+)?)%\)$/)![1]) / 100;
    };

    // Measured in card widths: the card is 1 × 88/63 (its image's proportions), from (0, 0).
    const cardHeight = 88 / 63;
    const side = Number(sidePercent) / 100;
    const width = 1 + 2 * side;
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
    /** A box's corners, from `left` to `right` and down the card's height. */
    const corners = (left: number, right: number) => [left, right].flatMap((x) => [0, cardHeight].map((y) => [x, y] as const));
    /** True when every point is outside the band, all on the same side of it. */
    const clear = (points: (readonly [number, number])[], shift: number) => {
      const at = points.map(([x, y]) => along(x, y, shift));
      return Math.max(...at) <= first || Math.min(...at) >= last;
    };
    return { stops, side, shiftAt, corners, clear };
  }

  it('fades in from and out to nothing', () => {
    const { stops } = sheen();
    expect(stops).toMatch(/^transparent \S+%, .* transparent \S+%$/);
  });

  it('starts and ends each pass with the band off the card, so the loop never jumps', () => {
    const { shiftAt, corners, clear } = sheen();
    expect(clear(corners(0, 1), shiftAt('0%'))).toBe(true);
    expect(clear(corners(0, 1), shiftAt('100%'))).toBe(true);
  });

  it('crosses the card on the way', () => {
    const { corners, clear } = sheen();
    expect(clear(corners(0, 1), 0)).toBe(false);
  });

  it("never reaches its layer's sides, where the band would be cut off straight as it crosses", () => {
    const { side, corners, clear } = sheen();
    expect(clear(corners(-side, -side), 0)).toBe(true);
    expect(clear(corners(1 + side, 1 + side), 0)).toBe(true);
  });

  it('stands still, across the middle of the card, for those who ask for less motion', () => {
    const media = index.indexOf('@media (prefers-reduced-motion: reduce)', index.indexOf('.card-tile__sheen'));
    expect(media).toBeGreaterThan(0);
    expect(rule(block(index, index.indexOf('{', media)), '.card-tile__sheen::before')).toEqual({ animation: 'none', transform: 'none' });
  });
});
