import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The muted pair — `--muted-foreground` on `--muted` — is a real text-on-
 * surface pairing (pill tabs, count chips, table cells), not just a tint on
 * the page, so it must clear WCAG 2.1 AA's 4.5:1 for normal text in BOTH
 * themes. A lighter foreground once read 4.40:1 (2026-09-26 evaluation,
 * G-03); this keeps the token from drifting back.
 */
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  return css.slice(start, css.indexOf('}', start));
}

function token(scope: string, name: string): [number, number, number] {
  const match = new RegExp(
    `--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`,
  ).exec(scope);
  if (!match) throw new Error(`no --${name} token`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** HSL → sRGB (0..1), the CSS Color 4 algorithm. */
function hslToRgb([h, s, l]: [number, number, number]): [
  number,
  number,
  number,
] {
  const sat = s / 100;
  const light = l / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = Math.round(c * 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(scope: string, fg: string, bg: string): number {
  const lf = luminance(hslToRgb(token(scope, fg)));
  const lb = luminance(hslToRgb(token(scope, bg)));
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
}

describe('globals.css muted text tokens', () => {
  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ])('%s: muted-foreground on muted meets AA (4.5:1)', (_theme, selector) => {
    const scope = block(selector);
    expect(contrast(scope, 'muted-foreground', 'muted')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(scope, 'muted-foreground', 'background'),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
