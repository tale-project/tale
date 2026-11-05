import { afterEach, describe, expect, it, vi } from 'vitest';

import { isValidLocale } from './is-valid-locale';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isValidLocale', () => {
  it('accepts a well-formed tag without logging', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isValidLocale('de-CH')).toBe(true);
    expect(warned).not.toHaveBeenCalled();
  });

  it('refuses a malformed tag with a warning, not an error a monitor would report', () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errored = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(isValidLocale('!!!')).toBe(false);

    expect(warned).toHaveBeenCalledWith(
      'Invalid locale tag:',
      '!!!',
      expect.any(RangeError),
    );
    expect(errored).not.toHaveBeenCalled();
  });
});
