import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCENT_INK_DARK,
  ACCENT_INK_LIGHT,
  adjustColorForTheme,
  contrastRatio,
  deriveAccentPalette,
  hexToHsl,
  hexToHslParts,
  hslToHex,
  isHexColor,
  relativeLuminance,
  THEME_BACKGROUND,
} from './color';

const WHITE = '#FFFFFF';
const DARK_BG = '#0A0A0A';

describe('hexToHsl', () => {
  it('converts pure red', () => {
    expect(hexToHsl('#FF0000')).toBe('0 100% 50%');
  });

  it('converts pure green', () => {
    expect(hexToHsl('#00FF00')).toBe('120 100% 50%');
  });

  it('converts pure blue', () => {
    expect(hexToHsl('#0000FF')).toBe('240 100% 50%');
  });

  it('converts black', () => {
    expect(hexToHsl('#000000')).toBe('0 0% 0%');
  });

  it('converts white', () => {
    expect(hexToHsl('#FFFFFF')).toBe('0 0% 100%');
  });

  it('converts a mid-gray', () => {
    expect(hexToHsl('#808080')).toBe('0 0% 50%');
  });

  it('handles lowercase hex', () => {
    expect(hexToHsl('#ff0000')).toBe('0 100% 50%');
  });
});

describe('hexToHslParts', () => {
  it('decomposes a primary color', () => {
    expect(hexToHslParts('#FF0000')).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('handles achromatic colors', () => {
    expect(hexToHslParts('#808080')).toMatchObject({ h: 0, s: 0 });
  });
});

describe('hslToHex', () => {
  it('round-trips primary colors through hexToHslParts', () => {
    for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000']) {
      const { h, s, l } = hexToHslParts(hex);
      expect(hslToHex(h, s, l).toLowerCase()).toBe(hex.toLowerCase());
    }
  });
});

describe('relativeLuminance / contrastRatio', () => {
  it('anchors black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('white-on-black is the maximum 21:1', () => {
    expect(contrastRatio(WHITE, '#000000')).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      6,
    );
  });
});

describe('isHexColor', () => {
  it('accepts a complete 6- or 8-digit hex and nothing shorter', () => {
    expect(isHexColor('#E11D48')).toBe(true);
    expect(isHexColor('#e11d48ff')).toBe(true);
    for (const partial of ['', '#', '#E', '#E1', '#12', '#E11', '#E11D4']) {
      expect(isHexColor(partial)).toBe(false);
    }
    expect(isHexColor('E11D48')).toBe(false);
    expect(isHexColor('#GGGGGG')).toBe(false);
  });
});

describe('a partial hex typed one character at a time', () => {
  // The branding hex field emits `#E`, `#E1`, … on every keystroke. Those
  // parse to NaN channels, and a lightness walk over NaN neither clamps nor
  // clears a contrast threshold — it used to spin the renderer forever.
  const PARTIALS = ['#E', '#E1', '#12', '#E11', '#E11D', '#E11D4'];

  it.each(PARTIALS)('adjustColorForTheme answers %s untouched', (partial) => {
    expect(adjustColorForTheme(partial, 'light')).toBe(partial);
    expect(adjustColorForTheme(partial, 'dark')).toBe(partial);
  });

  it.each(PARTIALS)('deriveAccentPalette returns for %s', (partial) => {
    expect(deriveAccentPalette(partial, 'light').base).toBe(partial);
    expect(deriveAccentPalette(partial, 'dark').base).toBe(partial);
    expect(deriveAccentPalette(partial, 'light').text).toBe(partial);
    expect(deriveAccentPalette(partial, 'dark').text).toBe(partial);
  });
});

describe('adjustColorForTheme', () => {
  it('leaves a color untouched in the theme it already fits', () => {
    // A near-black brand reads fine on the light theme.
    expect(adjustColorForTheme('#1A1A1A', 'light')).toBe('#1A1A1A');
    // A near-white brand reads fine on the dark theme.
    expect(adjustColorForTheme('#EFEFEF', 'dark')).toBe('#EFEFEF');
  });

  it('lightens a dark color so it clears contrast on the dark theme', () => {
    const adjusted = adjustColorForTheme('#1A1A1A', 'dark');
    expect(adjusted).not.toBe('#1A1A1A');
    expect(contrastRatio(adjusted, DARK_BG)).toBeGreaterThanOrEqual(3);
    expect(relativeLuminance(adjusted)).toBeGreaterThan(
      relativeLuminance('#1A1A1A'),
    );
  });

  it('darkens a light color so it clears contrast on the light theme', () => {
    const adjusted = adjustColorForTheme('#EFEFEF', 'light');
    expect(adjusted).not.toBe('#EFEFEF');
    expect(contrastRatio(adjusted, WHITE)).toBeGreaterThanOrEqual(3);
    expect(relativeLuminance(adjusted)).toBeLessThan(
      relativeLuminance('#EFEFEF'),
    );
  });

  it('leaves a mid-tone that fits both themes untouched', () => {
    // #3B82F6 clears 3:1 against both white and the dark background.
    expect(adjustColorForTheme('#3B82F6', 'light')).toBe('#3B82F6');
    expect(adjustColorForTheme('#3B82F6', 'dark')).toBe('#3B82F6');
  });
});

describe('THEME_BACKGROUND', () => {
  // The palette is judged against the page it is painted on. It was once
  // judged against pure white while the light page is #FCFCFC, so a pick
  // walked to exactly 3:1 read 2.96:1 where it was actually shown.
  const css = readFileSync(
    join(__dirname, '../../../../packages/ui/src/globals.css'),
    'utf8',
  );

  function background(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    const scope = css.slice(start, css.indexOf('}', start));
    const match = /--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(
      scope,
    );
    if (start < 0 || !match) throw new Error(`no ${selector} --background`);
    return hslToHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  it('is the page the stylesheet paints in each theme', () => {
    expect(THEME_BACKGROUND.light.toLowerCase()).toBe(background(':root'));
    expect(THEME_BACKGROUND.dark.toLowerCase()).toBe(background('.dark'));
  });
});

/** The CSS-variable HSL the provider injects, back to the hex it paints. */
function paintedHsl(hsl: string): string {
  const [h, s, l] = hsl.replaceAll('%', '').split(' ').map(Number);
  return hslToHex(h ?? NaN, s ?? NaN, l ?? NaN);
}

/** `top` over `bottom` at `alpha`, as the browser composites a tint. */
function tint(top: string, bottom: string, alpha: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = channels(top);
  const b = channels(bottom);
  return `#${a
    .map((value, i) =>
      Math.round(value * alpha + (b[i] ?? 0) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

describe('deriveAccentPalette', () => {
  const THEMES = ['light', 'dark'] as const;
  const BACKGROUNDS = THEME_BACKGROUND;
  // Deliberately hostile picks: near-invisible on one theme, mid-tone
  // saturated (the worst zone for text ink), and both extremes.
  const BAD_PICKS = [
    '#000000',
    '#FFFFFF',
    '#1A1A1A',
    '#EFEFEF',
    '#FF0000',
    '#808080',
    '#FF0055',
    '#3B82F6',
    // The accent audit (TALE-8): a near-white, a near-black navy and a
    // mid-tone that each failed somewhere — a surface under 3:1 on the real
    // light page, or text set in the accent at 2.4–2.9:1.
    '#F5F5F0',
    '#0B0B2A',
    '#FF00FF',
    // Pure hues whose light-theme surface landed at 2.93–2.96:1 on the page.
    '#FFFF00',
    '#00FF00',
    // Picks whose rounded `--primary` HSL string painted below a threshold
    // its hex had cleared.
    '#008833',
    '#443366',
  ];

  it.each(THEMES)(
    'normalizes any pick into a legible %s-theme palette',
    (theme) => {
      for (const pick of BAD_PICKS) {
        const palette = deriveAccentPalette(pick, theme);
        // Surface visible against the page (WCAG 1.4.11 non-text floor).
        expect(
          contrastRatio(palette.base, BACKGROUNDS[theme]),
        ).toBeGreaterThanOrEqual(3);
        // Ink legible on the surface (WCAG AA normal text).
        expect(contrastRatio(palette.base, palette.fg)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it.each(THEMES)(
    'sets the accent as %s-theme text that reads on the page and its tint',
    (theme) => {
      for (const pick of BAD_PICKS) {
        const { text } = deriveAccentPalette(pick, theme);
        const page = BACKGROUNDS[theme];
        // A link, a mention, a citation: text on the page (WCAG 1.4.3).
        expect(contrastRatio(text, page), pick).toBeGreaterThanOrEqual(4.5);
        // The selected row's `…26` and a mention's `/10` at rest, a
        // citation's `/20` on hover: text on its own tint.
        for (const alpha of [0.1, 0x26 / 255, 0.2]) {
          expect(
            contrastRatio(text, tint(text, page, alpha)),
            `${pick} on its ${alpha} tint`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(THEMES)(
    'paints the %s-theme legacy tokens as the colors they were checked as',
    (theme) => {
      for (const pick of BAD_PICKS) {
        const palette = deriveAccentPalette(pick, theme);
        // `--primary` / `--ring` paint exactly the checked text shade. Not a
        // tautology: a rounded string of the hex (`hexToHsl(text)`, the way
        // `baseHsl` was built) paints `#9582c0` for `#443366` on dark, not
        // the checked `#9682c0`. The painted proof is
        // `accent-chrome.browser.test.tsx`…
        expect(paintedHsl(palette.textHsl), pick).toBe(
          palette.text.toLowerCase(),
        );
        // …and `--primary-foreground` reads on a `bg-primary` fill.
        expect(
          contrastRatio(paintedHsl(palette.onTextHsl), palette.text),
          pick,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('audits #F5F5F0: a near-white surface clears 3:1 on the light page', () => {
    const light = deriveAccentPalette('#F5F5F0', 'light');
    expect(contrastRatio(light.base, BACKGROUNDS.light)).toBeGreaterThanOrEqual(
      3,
    );
    // The dark theme already fits it: surface and text stay the pick.
    expect(deriveAccentPalette('#F5F5F0', 'dark').base).toBe('#F5F5F0');
    expect(deriveAccentPalette('#F5F5F0', 'dark').text).toBe('#f5f5f0');
  });

  it('audits #0B0B2A: the lifted navy reads as text on the dark theme', () => {
    const dark = deriveAccentPalette('#0B0B2A', 'dark');
    // The surface was lifted to 3:1 before; the text shade goes further,
    // on the same hue.
    expect(contrastRatio(dark.text, BACKGROUNDS.dark)).toBeGreaterThan(
      contrastRatio(dark.base, BACKGROUNDS.dark),
    );
    expect(hexToHslParts(dark.text).h).toBe(hexToHslParts('#0B0B2A').h);
  });

  it('audits #FF00FF: the button keeps the pick, its text deepens', () => {
    const light = deriveAccentPalette('#FF00FF', 'light');
    expect(light.base).toBe('#FF00FF');
    expect(contrastRatio(light.text, BACKGROUNDS.light)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(hexToHslParts(light.text).h).toBe(300);
    // On the dark page the pick already reads as text.
    expect(deriveAccentPalette('#FF00FF', 'dark').text).toBe('#ff00ff');
  });

  it('picks the ink by real contrast, not a lightness guess', () => {
    expect(deriveAccentPalette('#FFEB3B', 'light').fg).toBe(ACCENT_INK_DARK);
    expect(deriveAccentPalette('#1B5E20', 'light').fg).toBe(ACCENT_INK_LIGHT);
  });

  it('keeps a surface that already satisfies both constraints untouched', () => {
    const palette = deriveAccentPalette('#3B82F6', 'light');
    expect(palette.base).toBe('#3B82F6');
    // 3.6:1 is a surface, not text: the text shade is the same hue, deeper.
    expect(palette.text).not.toBe(palette.base.toLowerCase());
    expect(hexToHslParts(palette.text).h).toBe(hexToHslParts('#3B82F6').h);
  });

  it('keeps a pick that already reads as text as its own text shade', () => {
    // Held as whole HSL parts, so the hex and `--primary` agree exactly.
    const palette = deriveAccentPalette('#1B5E20', 'light');
    expect(palette.textHsl).toBe(hexToHsl('#1B5E20'));
    expect(palette.text).toBe(paintedHsl(hexToHsl('#1B5E20')));
  });

  it('derives a muted shade that keeps the accent hue', () => {
    const { h } = hexToHslParts('#FF0055');
    expect(deriveAccentPalette('#FF0055', 'light').mutedHsl).toMatch(
      new RegExp(`^${h} \\d+% 60%$`),
    );
    expect(deriveAccentPalette('#FF0055', 'dark').mutedHsl).toMatch(
      new RegExp(`^${h} \\d+% 75%$`),
    );
  });
});
