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
 * Resolves a declared colour in a theme: a hex, `hsl(var(--x))`,
 * `hsl(var(--x) / a)` or `var(--color-…)`, following variables through the
 * theme's block, then `:root`, then `@theme`.
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
