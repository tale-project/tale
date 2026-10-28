import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The code palette (`--code-*` in `globals.css`) is read by every code
 * surface: Shiki's read-only blocks in chat, docs and the guides, and the
 * code editor. Shiki's min-light and min-dark failed AA there (comments
 * 1.69:1 on the code-block surface, parameters 2.06:1, constants 4.40:1),
 * so every token colour here must clear 4.5:1 on each surface code sits on
 * — the page, the code-block surface and a card — and on the template tint
 * over each, in both themes. The editor's line numbers are text (4.5:1);
 * its problem underlines are marks (3:1).
 *
 * A diff (`--diff-*`) tints the lines it added or removed and, over that,
 * the words that changed: every token keeps 4.5:1 on both tints over each
 * code surface. Its three colours are text and borders on the card and the
 * muted surface, and a removed flow box keeps its words readable on its
 * hatch. In forced colours the tints drop.
 */

// Comments name tokens too (`--background: …` in prose); read declarations only.
const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

type Rgb = [number, number, number];

function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  return css.slice(start, css.indexOf('\n}', start));
}

const THEME_BLOCK = (() => {
  const start = css.indexOf('@theme {');
  return css.slice(start, css.indexOf('\n}', start));
})();

function declared(scope: string, name: string): string | undefined {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(scope);
  return match?.[1].trim();
}

/** HSL → sRGB 0..255, the CSS Color 4 algorithm. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}

function hexToRgb(hex: string): Rgb {
  const digits = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
}

interface Paint {
  rgb: Rgb;
  alpha: number;
}

/**
 * Resolves a declared colour in a theme: a hex, `rgb(r g b / a)`,
 * `hsl(var(--x))`, `hsl(var(--x) / a)` or `var(--color-…)`, following
 * variables through the theme's block, then `:root`, then `@theme`.
 */
function resolve(theme: 'light' | 'dark', value: string): Paint {
  const scopes =
    theme === 'dark' ? [block('.dark'), block(':root')] : [block(':root')];
  const lookup = (name: string): string => {
    for (const scope of [...scopes, THEME_BLOCK]) {
      const found = declared(scope, name);
      if (found !== undefined) return found;
    }
    throw new Error(`--${name} is not declared`);
  };
  const hex = /^#[0-9a-f]{6}$/i.exec(value);
  if (hex) return { rgb: hexToRgb(value), alpha: 1 };
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (rgb) {
    return {
      rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])],
      alpha: rgb[4] ? Number(rgb[4]) : 1,
    };
  }
  // The legacy tokens hold a bare HSL triple: `0 0% 3.92%`.
  const triple = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (triple) {
    return {
      rgb: hslToRgb(Number(triple[1]), Number(triple[2]), Number(triple[3])),
      alpha: 1,
    };
  }
  const hsl = /^hsl\(var\(--([a-z-]+)\)(?:\s*\/\s*([\d.]+))?\)$/.exec(value);
  if (hsl) {
    const [h, s, l] = lookup(hsl[1])
      .replaceAll('%', '')
      .split(/\s+/)
      .map(Number);
    return { rgb: hslToRgb(h, s, l), alpha: hsl[2] ? Number(hsl[2]) : 1 };
  }
  const variable = /^var\(--([a-z-]+)\)$/.exec(value);
  if (variable) return resolve(theme, lookup(variable[1]));
  throw new Error(`cannot resolve ${value}`);
}

function token(theme: 'light' | 'dark', name: string): Paint {
  const scopes =
    theme === 'dark'
      ? [block('.dark'), block(':root'), THEME_BLOCK]
      : [block(':root'), THEME_BLOCK];
  for (const scope of scopes) {
    const found = declared(scope, name);
    if (found !== undefined) return resolve(theme, found);
  }
  throw new Error(`--${name} is not declared`);
}

function over(top: Paint, base: Rgb): Rgb {
  return top.rgb.map((c, i) =>
    Math.round(c * top.alpha + base[i] * (1 - top.alpha)),
  ) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The surfaces code sits on, with the template tint over the editor's. The
 * tint is the editor's chip behind a `{{ }}` expression; read-only blocks
 * draw none, and `muted` is a read-only surface only (the chat's code
 * blocks, the document preview).
 */
function surfaces(theme: 'light' | 'dark'): Array<[string, Rgb]> {
  const editor: Array<[string, Rgb]> = [
    ['background', token(theme, 'background').rgb],
    ['bg-elevated', token(theme, 'color-bg-elevated').rgb],
    ['card', token(theme, 'card').rgb],
  ];
  const tint = token(theme, 'code-template-tint');
  return [
    ...editor,
    ...editor.map(([name, rgb]): [string, Rgb] => [
      `${name} + template`,
      over(tint, rgb),
    ]),
    ['muted', token(theme, 'muted').rgb],
  ];
}

const TOKENS = [
  'code-foreground',
  'code-token-keyword',
  'code-token-string',
  'code-token-string-expression',
  'code-token-constant',
  'code-token-function',
  'code-token-parameter',
  'code-token-comment',
  'code-token-punctuation',
  'code-token-link',
  'code-token-inserted',
  'code-token-deleted',
  'code-token-changed',
  'code-invalid',
];

const MARKS = [
  'code-squiggle-error',
  'code-squiggle-warning',
  'code-squiggle-info',
];

describe.each(['light', 'dark'] as const)('the %s code palette', (theme) => {
  it.each(TOKENS)('--%s clears 4.5:1 on every code surface', (name) => {
    const colour = token(theme, name).rgb;
    for (const [surface, rgb] of surfaces(theme)) {
      expect(
        contrast(colour, rgb),
        `--${name} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the line numbers at 4.5:1 on the editor and code-block surfaces', () => {
    for (const name of ['code-line-number', 'code-line-number-active']) {
      const colour = token(theme, name).rgb;
      for (const [surface, rgb] of surfaces(theme).slice(0, 3)) {
        expect(
          contrast(colour, rgb),
          `--${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(MARKS)('--%s keeps 3:1 as a mark, tint included', (name) => {
    const colour = token(theme, name).rgb;
    for (const [surface, rgb] of surfaces(theme)) {
      expect(
        contrast(colour, rgb),
        `--${name} on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps selected text readable', () => {
    const selection = token(theme, 'code-selection');
    const foreground = token(theme, 'code-foreground').rgb;
    for (const [surface, rgb] of surfaces(theme).slice(0, 3)) {
      expect(
        contrast(foreground, over(selection, rgb)),
        `foreground on the selection over ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** The diff's colours and tints by kind. */
const DIFF_COLOURS = ['diff-added', 'diff-removed', 'diff-changed'];
const DIFF_TINTED = ['added', 'removed'] as const;
const DIFF_TINTS = [
  'diff-added-bg',
  'diff-added-emphasis',
  'diff-removed-bg',
  'diff-removed-emphasis',
  'diff-removed-hatch',
];

/** Where a diff's colour is text or a border: the card, the page and the
 *  muted surface (a list row's hover and current fill). */
function diffSurfaces(theme: 'light' | 'dark'): Array<[string, Rgb]> {
  return ['card', 'background', 'muted'].map((name): [string, Rgb] => [
    name,
    token(theme, name).rgb,
  ]);
}

describe.each(['light', 'dark'] as const)('the %s diff colours', (theme) => {
  it.each(DIFF_TINTED)(
    'keep every code token at 4.5:1 on an %s line and on its changed words',
    (kind) => {
      const lineTint = token(theme, `diff-${kind}-bg`);
      const wordTint = token(theme, `diff-${kind}-emphasis`);
      for (const [surface, rgb] of surfaces(theme).slice(0, 3)) {
        const line = over(lineTint, rgb);
        // A changed word's tint is drawn over its line's.
        const words = over(wordTint, line);
        for (const name of [...TOKENS, `diff-${kind}`]) {
          const colour = token(theme, name).rgb;
          expect(
            contrast(colour, line),
            `--${name} on the ${kind} line over ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(colour, words),
            `--${name} on the ${kind} words over ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(DIFF_COLOURS)(
    '--%s reads as text, and so as a border, on the card, the page and the muted surface',
    (name) => {
      const colour = token(theme, name).rgb;
      for (const [surface, rgb] of diffSurfaces(theme)) {
        expect(
          contrast(colour, rgb),
          `--${name} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('keeps a removed box’s words readable on its hatch, under 8 % alpha', () => {
    const hatch = token(theme, 'diff-removed-hatch');
    expect(hatch.alpha).toBeLessThanOrEqual(0.08);
    const surface = over(hatch, token(theme, 'card').rgb);
    for (const name of ['foreground', 'muted-foreground', ...DIFF_COLOURS]) {
      expect(
        contrast(token(theme, name).rgb, surface),
        `--${name} on the hatch`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('tints a changed word at least as much again as its line', () => {
    for (const kind of DIFF_TINTED) {
      const line = token(theme, `diff-${kind}-bg`);
      const words = token(theme, `diff-${kind}-emphasis`);
      expect(line.alpha, `${kind} line tint`).toBeGreaterThan(0);
      expect(words.alpha, `${kind} word tint`).toBeGreaterThanOrEqual(
        line.alpha,
      );
    }
  });
});

describe('the diff colours in forced colours', () => {
  const start = css.indexOf('@media (forced-colors: active) {');
  const forced = css.slice(start, css.indexOf('\n}', start));

  it('drop every tint and draw the change in the text colour', () => {
    for (const name of DIFF_TINTS)
      expect(declared(forced, name), `--${name}`).toBe('transparent');
    for (const name of DIFF_COLOURS)
      expect(declared(forced, name), `--${name}`).toBe('CanvasText');
  });
});
