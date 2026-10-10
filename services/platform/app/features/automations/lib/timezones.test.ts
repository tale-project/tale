import { describe, expect, it } from 'vitest';

import { isValidTimezone, listTimezoneOptions } from './timezones';

describe('isValidTimezone', () => {
  it.each([
    'UTC',
    'Europe/Zurich',
    'America/New_York',
    'europe/zurich',
    '+05:30',
  ])('accepts %s', (zone) => {
    expect(isValidTimezone(zone)).toBe(true);
  });

  it.each(['', '   ', 'Mars/Olympus', 'Europe/Nowhere'])(
    'refuses %j like the bind does',
    (zone) => {
      expect(isValidTimezone(zone)).toBe(false);
    },
  );
});

describe('listTimezoneOptions', () => {
  it('puts UTC first, then the reader’s zone, and includes an extra stored zone', () => {
    const zones = listTimezoneOptions('Etc/GMT+2', 'Europe/Zurich');
    expect(zones[0]).toBe('UTC');
    expect(zones[1]).toBe('Europe/Zurich');
    expect(zones).toContain('Etc/GMT+2');
    expect(zones.filter((zone) => zone === 'Europe/Zurich')).toHaveLength(1);
  });

  it('sorts the rest by name', () => {
    const rest = listTimezoneOptions().slice(1);
    expect(rest).toEqual(rest.toSorted((a, b) => a.localeCompare(b)));
  });
});
