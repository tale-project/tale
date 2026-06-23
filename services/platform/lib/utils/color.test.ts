import { describe, expect, it } from 'vitest';

import {
  adjustColorForTheme,
  contrastRatio,
  hexToHsl,
  hexToHslParts,
  hslToHex,
  isLightColor,
  relativeLuminance,
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

describe('isLightColor', () => {
  it('white is light', () => {
    expect(isLightColor('#FFFFFF')).toBe(true);
  });

  it('black is not light', () => {
    expect(isLightColor('#000000')).toBe(false);
  });

  it('yellow is light', () => {
    expect(isLightColor('#FFFF00')).toBe(true);
  });

  it('dark blue is not light', () => {
    expect(isLightColor('#000080')).toBe(false);
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
