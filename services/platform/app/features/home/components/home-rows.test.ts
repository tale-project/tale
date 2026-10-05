import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  deriveAccentPalette,
  hslToHex,
} from '@/lib/utils/color';

const source = readFileSync(join(__dirname, 'home-rows.tsx'), 'utf8');
const ageClass = /^const HOME_ROW_AGE_CLASS =\s+'([^']+)'/m.exec(source)?.[1];
const css = readFileSync(
  join(__dirname, '../../../../../../packages/ui/src/globals.css'),
  'utf8',
);
const highlight = readFileSync(
  join(
    __dirname,
    '../../../../../../packages/ui/src/components/layout/section-nav.tsx',
  ),
  'utf8',
);

function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const scope = css.slice(start, css.indexOf('}', start));
  const match = new RegExp(
    `--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`,
  ).exec(scope);
  if (!match) throw new Error(`no --${name} token in ${selector}`);
  return hslToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

function composite(top: string, bottom: string, alpha: number): string {
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(
        Number.parseInt(top.slice(offset, offset + 2), 16) * alpha +
          Number.parseInt(bottom.slice(offset, offset + 2), 16) * (1 - alpha),
      )
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

describe('Home row age styling', () => {
  it('uses the full muted foreground token for AA contrast', () => {
    expect(ageClass).toBeDefined();
    expect(ageClass).toContain('text-muted-foreground');
    expect(ageClass).not.toMatch(/text-muted-foreground\/\d+/);
    expect(ageClass).toContain('text-[11px]');
  });

  it('models the active row ink and shipped highlight alpha', () => {
    expect(source).toContain('HOME_ROW_AGE_CLASS,');
    expect(source).toContain("className: 'text-foreground font-medium'");
    expect(source).toContain('style: { color: accentColor }');
    expect(highlight).toContain('backgroundColor: `${accentColor}26`');
    expect(highlight).toContain("!accentColor && 'bg-muted'");
  });

  it('compiles the active age override as inherited row ink', async () => {
    const compiler = await compile('@tailwind utilities;');
    const compiled = compiler.build(ageClass?.split(' ') ?? []);
    expect(compiled).toContain('[aria-current=page] &');
    expect(compiled).toContain('color: inherit;');
  });

  describe.each(['light', 'dark'] as const)('%s contrast', (theme) => {
    const selector = theme === 'light' ? ':root' : '.dark';
    const background = token(selector, 'background');
    const muted = token(selector, 'muted');
    const mutedForeground = token(selector, 'muted-foreground');
    const inheritsActiveInk = ageClass?.includes(
      '[[aria-current=page]_&]:text-inherit',
    );

    it.each(['idle', 'hover', 'highlighted'] as const)(
      'meets AA on the neutral %s surface',
      (state) => {
        const surface =
          state === 'idle'
            ? background
            : state === 'hover'
              ? composite(muted, background, 0.6)
              : muted;
        const foreground =
          state === 'highlighted' && inheritsActiveInk
            ? token(selector, 'foreground')
            : mutedForeground;
        expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each(['#000000', '#056CFF', '#FF00FF', '#F5F5F0', '#0B0B2A'])(
      'meets AA on the branded %s highlight, including hover',
      (accent) => {
        const { text } = deriveAccentPalette(accent, theme);
        const surface = composite(text, background, 0x26 / 255);
        const foreground = inheritsActiveInk ? text : mutedForeground;
        expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      },
    );
  });
});
