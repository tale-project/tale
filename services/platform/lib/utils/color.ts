/** Parse a hex color string into normalized [0,1] sRGB channels. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  return {
    r: parseInt(cleaned.slice(0, 2), 16) / 255,
    g: parseInt(cleaned.slice(2, 4), 16) / 255,
    b: parseInt(cleaned.slice(4, 6), 16) / 255,
  };
}

interface Hsl {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

/** Convert a hex color string to HSL components (h 0–360, s/l 0–100). */
export function hexToHslParts(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert a hex color string to the space-separated HSL format
 * used by the CSS variables in globals.css (e.g., "240 5.9% 10%").
 */
export function hexToHsl(hex: string): string {
  const { h, s, l } = hexToHslParts(hex);
  return `${h} ${s}% ${l}%`;
}

/** Convert HSL components (h 0–360, s/l 0–100) back to a `#RRGGBB` hex string. */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = ln - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (gamma-corrected sRGB) in [0,1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/** WCAG contrast ratio between two hex colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determine whether a hex color is "light" (luminance > 0.5).
 * Used to derive foreground contrast colors.
 */
export function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);

  // Relative luminance (sRGB)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5;
}

/** Page background each theme applies the branded color against. */
const THEME_BACKGROUND = { light: '#FFFFFF', dark: '#0A0A0A' } as const;
const LIGHTNESS_STEP = 2;

/**
 * Adapt a single branded color so it stays legible in the given theme.
 *
 * A color is picked once but applied to both light and dark mode; one of the
 * two backgrounds is usually the worse fit (a dark brand vanishes on the dark
 * theme, a light brand on the light theme). When the color already clears
 * `minContrast` against this theme's background it is returned untouched —
 * that's the theme it "fits". Otherwise its HSL lightness is nudged toward the
 * contrasting direction (lighter on dark, darker on light) until it clears the
 * threshold or lightness clamps.
 */
export function adjustColorForTheme(
  hex: string,
  theme: 'light' | 'dark',
  minContrast = 3,
): string {
  const background = THEME_BACKGROUND[theme];
  if (contrastRatio(hex, background) >= minContrast) {
    return hex;
  }

  const { h, s, l } = hexToHslParts(hex);
  const direction = theme === 'dark' ? 1 : -1;

  let lightness = l;
  let candidate = hex;
  for (;;) {
    // Step first, then test the clamp — a walk may START at a boundary (pure
    // black on the dark theme, pure white on the light one) and must still
    // move inward rather than return the invisible original untouched.
    const next = Math.min(
      100,
      Math.max(0, lightness + direction * LIGHTNESS_STEP),
    );
    if (next === lightness) break; // clamped at the endpoint
    lightness = next;
    candidate = hslToHex(h, s, lightness);
    if (contrastRatio(candidate, background) >= minContrast) {
      return candidate;
    }
  }

  // Threshold unreachable (e.g. fully saturated mid-tone); return the
  // best-contrast endpoint we walked to rather than the original.
  return candidate;
}

/**
 * The two foreground inks a branded surface can carry — the same values the
 * design system uses for `--color-accent-fg` in globals.css (light/dark).
 */
export const ACCENT_INK_DARK = '#030712';
export const ACCENT_INK_LIGHT = '#ffffff';

/** WCAG AA contrast for normal text — the target for ink on the accent. */
const MIN_FG_CONTRAST = 4.5;
/** WCAG 1.4.11 non-text contrast — the floor for the accent vs. the page. */
const MIN_BG_CONTRAST = 3;

/**
 * The whole branded palette derived from one accent color, per theme. Hex
 * values feed the canonical `@tale/ui` tokens (`--color-accent-*`); the
 * space-separated HSL strings feed the legacy tokens (`--primary*`, `--ring`).
 */
interface AccentPalette {
  /** The theme-adjusted accent surface (hex). */
  base: string;
  /** Ink on top of `base` — `ACCENT_INK_DARK` or `ACCENT_INK_LIGHT` (hex). */
  fg: string;
  /** `base` as CSS-variable HSL (for `--primary` / `--ring`). */
  baseHsl: string;
  /** `fg` as CSS-variable HSL (for `--primary-foreground`). */
  fgHsl: string;
  /** A low-emphasis shade of the accent hue (for `--primary-muted`). */
  mutedHsl: string;
}

/**
 * Normalize ONE picked accent color into a coherent, WCAG-legible palette for
 * the given theme (#1960). Any input — even a "bad" color — comes out usable:
 *
 * 1. `base` starts from {@link adjustColorForTheme}, so it clears the 3:1
 *    non-text floor against the theme background where reachable.
 * 2. `fg` is whichever ink (near-black / white) has the HIGHER real contrast
 *    ratio on `base` — not a crude lightness guess. The better ink always
 *    clears ≈4.3:1 on any color; when it still falls short of the 4.5:1 AA
 *    text target, `base`'s lightness is nudged away from the ink until the
 *    target is met — stopping early rather than dropping below the 3:1
 *    background floor.
 * 3. `mutedHsl` keeps the accent hue at half saturation with the same
 *    lightness the default `--primary-muted` grays use per theme, so muted
 *    text stays muted but on-brand.
 */
export function deriveAccentPalette(
  hex: string,
  theme: 'light' | 'dark',
): AccentPalette {
  const background = THEME_BACKGROUND[theme];
  let base = adjustColorForTheme(hex, theme);

  const fg =
    contrastRatio(base, ACCENT_INK_DARK) >=
    contrastRatio(base, ACCENT_INK_LIGHT)
      ? ACCENT_INK_DARK
      : ACCENT_INK_LIGHT;

  // Dark ink wants a lighter surface; white ink wants a darker one.
  const direction = fg === ACCENT_INK_DARK ? 1 : -1;
  const { h, s, l } = hexToHslParts(base);
  let lightness = l;
  while (
    contrastRatio(base, fg) < MIN_FG_CONTRAST &&
    lightness > 0 &&
    lightness < 100
  ) {
    lightness = Math.min(
      100,
      Math.max(0, lightness + direction * LIGHTNESS_STEP),
    );
    const candidate = hslToHex(h, s, lightness);
    // Never trade the background floor for the text target — keep the best
    // base that satisfies both constraints as far as they're compatible.
    if (contrastRatio(candidate, background) < MIN_BG_CONTRAST) break;
    base = candidate;
  }

  const mutedLightness = theme === 'dark' ? 75 : 60;
  return {
    base,
    fg,
    baseHsl: hexToHsl(base),
    fgHsl: hexToHsl(fg),
    mutedHsl: `${h} ${Math.round(s / 2)}% ${mutedLightness}%`,
  };
}
