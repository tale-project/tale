import { describe, expect, it } from 'vitest';

import { hexToHsl, isLightColor } from './color';

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
