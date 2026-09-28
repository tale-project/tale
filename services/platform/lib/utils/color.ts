/** A complete hex color — `#RRGGBB`, optionally `#RRGGBBAA`. The same shape
 * the branding schema accepts; a value still being typed is not one. */
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

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
 * The page each theme applies the branded color against — the app's
 * `--background` in `packages/ui/src/globals.css` (`0 0% 98.8%` light,
 * `0 0% 3.92%` dark), which the panels and the chat column are painted in.
 * Not pure white: a pick walked to 3:1 against `#FFFFFF` read 2.96:1 on the
 * real page. `color.test.ts` holds these to the stylesheet.
 */
export const THEME_BACKGROUND = { light: '#FCFCFC', dark: '#0A0A0A' } as const;
const LIGHTNESS_STEP = 2;
/** The most steps a lightness walk can take from one end of the scale to
 * the other — the hard bound on every walk below, whatever the input. */
const MAX_LIGHTNESS_STEPS = Math.ceil(100 / LIGHTNESS_STEP) + 1;

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
 *
 * Only a complete hex color is walked. A partial one — a hex field being
 * typed one character at a time — parses to NaN channels, and a walk over
 * NaN never clamps and never clears the threshold; it is answered untouched.
 */
export function adjustColorForTheme(
  hex: string,
  theme: 'light' | 'dark',
  minContrast = 3,
): string {
  if (!isHexColor(hex)) return hex;
  const background = THEME_BACKGROUND[theme];
  if (contrastRatio(hex, background) >= minContrast) {
    return hex;
  }

  const { h, s, l } = hexToHslParts(hex);
  const direction = theme === 'dark' ? 1 : -1;

  let lightness = l;
  let candidate = hex;
  for (let step = 0; step < MAX_LIGHTNESS_STEPS; step++) {
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

/** WCAG AA contrast for normal text — the target for ink on the accent, and
 * for the accent where it is itself the ink (a link, a mention, a nav row). */
const MIN_FG_CONTRAST = 4.5;
/** WCAG 1.4.11 non-text contrast — the floor for the accent vs. the page. */
const MIN_BG_CONTRAST = 3;
/**
 * The densest tint the accent's own text sits on: a citation's hover
 * `bg-primary/20`. At rest it is lighter still — a selected row's
 * `${accent}26` (0x26 / 255 ≈ 15 %), a mention's `bg-primary/10` — so the
 * text clears them with room to spare.
 */
const ACCENT_TINT_ALPHA = 0.2;

/** `top` laid over `bottom` at `alpha` — how the browser composites a
 * translucent fill onto an opaque one, channel by channel in sRGB. */
function compositeOver(top: string, bottom: string, alpha: number): string {
  const a = hexToRgb(top);
  const b = hexToRgb(bottom);
  const channel = (t: number, u: number) =>
    Math.round((t * alpha + u * (1 - alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** Whether `hex` reads as normal-size text on the page AND on its own tint. */
function readsAsText(hex: string, background: string): boolean {
  return (
    contrastRatio(hex, background) >= MIN_FG_CONTRAST &&
    contrastRatio(hex, compositeOver(hex, background, ACCENT_TINT_ALPHA)) >=
      MIN_FG_CONTRAST
  );
}

/** The ink (near-black or white) with the higher real contrast on `hex`. */
function inkOn(hex: string): string {
  return contrastRatio(hex, ACCENT_INK_DARK) >=
    contrastRatio(hex, ACCENT_INK_LIGHT)
    ? ACCENT_INK_DARK
    : ACCENT_INK_LIGHT;
}

/**
 * The whole branded palette derived from one accent color, per theme. Hex
 * values feed the canonical `@tale/ui` tokens (`--color-accent-*`) and the
 * accent React context; the space-separated HSL strings feed the legacy
 * tokens (`--primary*`, `--ring`).
 */
interface AccentPalette {
  /** The theme-adjusted accent surface (hex) — `--color-accent-base`, the
   * primary button's fill. */
  base: string;
  /** Ink on top of `base` — `ACCENT_INK_DARK` or `ACCENT_INK_LIGHT` (hex). */
  fg: string;
  /** The accent where it is the ink itself (hex): link, mention and citation
   * text, the selected navigation row, unread dots, the focus ring. */
  text: string;
  /** `text` as CSS-variable HSL (for `--primary` / `--ring`). */
  textHsl: string;
  /** The ink on a `text`-coloured fill as CSS-variable HSL (for
   * `--primary-foreground`). */
  onTextHsl: string;
  /** A low-emphasis shade of the accent hue (for `--primary-muted`). */
  mutedHsl: string;
}

/**
 * The accent as text: the pick's own hue and saturation, walked one
 * lightness point at a time toward the contrasting end (darker on light,
 * lighter on dark) until it reads at 4.5:1 on the page and on its own tint.
 * Black and white always do, so the walk always ends. The result is kept as
 * whole HSL parts, so the hex and the `--primary` HSL string name the same
 * color — a rounded HSL string of an arbitrary hex could land below a
 * threshold its hex cleared.
 *
 * "The page" is the theme's `--background` ({@link THEME_BACKGROUND}); the
 * guarantee is judged there and nowhere else. Measured over an 8,000-pick
 * grid (20 steps a channel), elsewhere it holds as follows:
 *
 * - the light `--card` (`#FFFFFF`): everywhere, up to the `/20` hover;
 * - the dark `--sidebar` and the light `--muted`: plain and up to a selected
 *   row's `…26` tint, but ≈4.3:1 and ≈4.2:1 under a `/20` hover;
 * - the dark `--card` (`#171717`, lighter than the page): plain only — a
 *   hair under it (4.498:1) beneath a `/10` tint, ≈4.2:1 beneath `…26` and
 *   ≈3.9:1 beneath `/20`;
 * - the dark `--muted` and `--accent`: not even plain (≈4.0:1 and ≈3.8:1),
 *   so a `text-primary` row over `hover:bg-accent` reads below 4.5:1 there;
 *   a tint alone does not repair that backdrop. Text on a raised surface
 *   needs ink that clears contrast there (see `BL-5` in the manual layer's
 *   `reference/not-a-finding.md`).
 *
 * (The dark `--popover` is the page itself.) Judging the dark walk against
 * `#171717` instead would lift 57 % of dark text shades, most by 3–6
 * lightness points (up to 15); against `--muted` or `--accent`, 68–72 %, most
 * by 8–19 (up to 29). Either is a design call.
 */
function deriveAccentText(
  hex: string,
  theme: 'light' | 'dark',
): { hex: string; hsl: string } {
  if (!isHexColor(hex)) return { hex, hsl: hexToHsl(hex) };
  const background = THEME_BACKGROUND[theme];
  const direction = theme === 'dark' ? 1 : -1;
  const { h, s, l } = hexToHslParts(hex);
  let lightness = l;
  for (let step = 0; step <= 100; step++) {
    if (readsAsText(hslToHex(h, s, lightness), background)) break;
    const next = Math.min(100, Math.max(0, lightness + direction));
    if (next === lightness) break;
    lightness = next;
  }
  return { hex: hslToHex(h, s, lightness), hsl: `${h} ${s}% ${lightness}%` };
}

/**
 * Normalize ONE picked accent color into a coherent, WCAG-legible palette for
 * the given theme (#1960). Any input — even a "bad" color — comes out usable:
 *
 * 1. `base` starts from {@link adjustColorForTheme}, so it clears the 3:1
 *    non-text floor against the theme's page where reachable.
 * 2. `fg` is whichever ink (near-black / white) has the HIGHER real contrast
 *    ratio on `base` — not a crude lightness guess. The better ink always
 *    clears ≈4.3:1 on any color; when it still falls short of the 4.5:1 AA
 *    text target, `base`'s lightness is nudged away from the ink until the
 *    target is met — stopping early rather than dropping below the 3:1
 *    background floor.
 * 3. `text` is the accent where it is the ink itself. 3:1 is a floor for a
 *    surface, not for letters: a mid-tone like `#FF00FF` clears it on the
 *    light page, yet a link, a mention or a selected row set in it read
 *    2.4:1. `text` walks the pick to 4.5:1 on the page and on its own tint
 *    ({@link deriveAccentText}); the button keeps `base`, as close to the
 *    pick as legibility allows. Its ink clears 4.5:1 by construction.
 * 4. `mutedHsl` keeps the accent hue at half saturation with the same
 *    lightness the default `--primary-muted` grays use per theme, so muted
 *    text stays muted but on-brand.
 *
 * The input must be a complete hex color (`isHexColor`); a partial one is
 * answered as its own base with no walk, so a caller that renders while a
 * field is being typed cannot spin — pass the last complete color instead.
 */
export function deriveAccentPalette(
  hex: string,
  theme: 'light' | 'dark',
): AccentPalette {
  const background = THEME_BACKGROUND[theme];
  let base = adjustColorForTheme(hex, theme);

  const fg = inkOn(base);

  // Dark ink wants a lighter surface; white ink wants a darker one.
  const direction = fg === ACCENT_INK_DARK ? 1 : -1;
  const { h, s, l } = hexToHslParts(base);
  let lightness = l;
  let steps = 0;
  while (
    isHexColor(base) &&
    steps++ < MAX_LIGHTNESS_STEPS &&
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

  const text = deriveAccentText(hex, theme);
  const mutedLightness = theme === 'dark' ? 75 : 60;
  return {
    base,
    fg,
    text: text.hex,
    textHsl: text.hsl,
    onTextHsl: hexToHsl(inkOn(text.hex)),
    mutedHsl: `${h} ${Math.round(s / 2)}% ${mutedLightness}%`,
  };
}
