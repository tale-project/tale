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
  while (lightness > 0 && lightness < 100) {
    lightness = Math.min(
      100,
      Math.max(0, lightness + direction * LIGHTNESS_STEP),
    );
    candidate = hslToHex(h, s, lightness);
    if (contrastRatio(candidate, background) >= minContrast) {
      return candidate;
    }
  }

  // Threshold unreachable (e.g. fully saturated mid-tone); return the
  // best-contrast endpoint we walked to rather than the original.
  return candidate;
}
