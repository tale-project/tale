import { describe, expect, it } from 'vitest';

import {
  browserTimezone,
  listTimezoneOptions,
  listTimezones,
} from './timezone-options';

describe('listTimezones', () => {
  it('includes UTC and a representative IANA zone, sorted', () => {
    const zones = listTimezones();
    expect(zones).toContain('UTC');
    expect(zones).toContain('Europe/Paris');
    expect(zones).toEqual([...zones].sort());
  });
});

describe('listTimezoneOptions', () => {
  it('labels each zone with its current UTC offset', () => {
    const options = listTimezoneOptions();
    const utc = options.find((o) => o.value === 'UTC');
    // ICU renders the zero offset as "GMT" (macOS) or "GMT+0" (Linux CI).
    expect(utc?.label).toMatch(/^UTC \(GMT(\+0)?\)$/);

    const paris = options.find((o) => o.value === 'Europe/Paris');
    expect(paris?.label).toMatch(/^Europe\/Paris \(GMT[+-]\d+/);
  });

  it('has one option per known zone', () => {
    expect(listTimezoneOptions()).toHaveLength(listTimezones().length);
  });
});

describe('browserTimezone', () => {
  it('returns a non-empty IANA zone identifier', () => {
    const tz = browserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    // Must be a zone `Intl` itself recognizes (round-trips through the same API).
    expect(
      () => new Intl.DateTimeFormat(undefined, { timeZone: tz }),
    ).not.toThrow();
  });
});
