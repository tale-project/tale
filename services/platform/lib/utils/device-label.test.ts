import { describe, expect, it } from 'vitest';

import { deriveDeviceLabel } from './device-label';

describe('deriveDeviceLabel', () => {
  it('returns an empty string for missing or empty input', () => {
    expect(deriveDeviceLabel('')).toBe('');
    expect(deriveDeviceLabel(undefined)).toBe('');
    expect(deriveDeviceLabel(null)).toBe('');
  });

  it('labels Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(deriveDeviceLabel(ua)).toBe('Chrome on macOS');
  });

  it('labels Safari on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(deriveDeviceLabel(ua)).toBe('Safari on iPhone');
  });

  it('labels Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    expect(deriveDeviceLabel(ua)).toBe('Chrome on Windows');
  });

  it('prefers Edge over Chrome when both tokens are present', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    expect(deriveDeviceLabel(ua)).toBe('Edge on Windows');
  });

  it('detects Firefox on Linux', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
    expect(deriveDeviceLabel(ua)).toBe('Firefox on Linux');
  });

  it('detects Chrome on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
    expect(deriveDeviceLabel(ua)).toBe('Chrome on Android');
  });

  it('detects Chrome on iOS (CriOS) as Chrome on iPhone', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1';
    expect(deriveDeviceLabel(ua)).toBe('Chrome on iPhone');
  });

  it('falls back to the OS alone when the browser is unrecognized', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SomeUnknownAgent/1.0';
    expect(deriveDeviceLabel(ua)).toBe('Windows');
  });

  it('returns an empty string when nothing is recognized', () => {
    expect(deriveDeviceLabel('CustomBot/1.0')).toBe('');
  });
});
