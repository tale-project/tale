import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  customExpiryBounds,
  expiresAtAfter,
  expirySeconds,
  isCustomExpiryInRange,
} from './expiry';

const NOW = new Date(2026, 9, 7, 17, 30).getTime();
const day = (month: number, date: number, year = 2026) =>
  new Date(year, month, date).getTime();

describe('API key expiry', () => {
  it('offers only dates containing a lifetime the provider accepts', () => {
    const { minDate, maxDate } = customExpiryBounds(NOW);
    expect(minDate).toBe(day(9, 8));
    expect(maxDate).toBe(day(9, 7, 2027));
    expect(isCustomExpiryInRange(minDate, NOW)).toBe(true);
    expect(isCustomExpiryInRange(maxDate, NOW)).toBe(true);
    expect(isCustomExpiryInRange(day(9, 7), NOW)).toBe(false);
    expect(isCustomExpiryInRange(day(9, 8, 2027), NOW)).toBe(false);
  });

  it('keeps preset seconds and Never unchanged', () => {
    expect(expirySeconds('7', null, NOW)).toBe(604_800);
    expect(expirySeconds('30', null, NOW)).toBe(2_592_000);
    expect(expirySeconds('90', null, NOW)).toBe(7_776_000);
    expect(expirySeconds('365', null, NOW)).toBe(31_536_000);
    expect(expirySeconds('never', null, NOW)).toBeNull();
  });

  it('refuses missing, invalid and past custom dates', () => {
    expect(expirySeconds('custom', null, NOW)).toBeUndefined();
    expect(expirySeconds('custom', Number.NaN, NOW)).toBeUndefined();
    expect(expirySeconds('custom', Infinity, NOW)).toBeUndefined();
    expect(expirySeconds('custom', day(9, 7), NOW)).toBeUndefined();
  });

  it('dates the expiry the way the plugin stores it: now plus seconds', () => {
    expect(expiresAtAfter(90_000, NOW)).toBe(NOW + 90_000_000);
  });

  // Each child owns its TZ. Changing process.env.TZ in the shared Vitest
  // worker would make other files and cached Date instances order-dependent.
  it.each([
    {
      name: 'ordinary day preserves the selected date and local clock',
      now: '2027-02-01T17:30:00+01:00',
      selected: '2027-02-15T00:00:00+01:00',
      expiresAt: '2027-02-15T17:30:00+01:00',
    },
    {
      name: 'spring-forward tomorrow cannot fit the 24-hour minimum',
      now: '2027-03-27T23:30:00+01:00',
      selected: '2027-03-28T00:00:00+01:00',
      expiresAt: null,
      minimum: '2027-03-29T00:00:00+02:00',
    },
    {
      name: 'spring-forward later date keeps its date with a 47-hour lifetime',
      now: '2027-03-27T23:30:00+01:00',
      selected: '2027-03-29T00:00:00+02:00',
      expiresAt: '2027-03-29T23:30:00+02:00',
    },
    {
      name: 'minimum may shift the clock within the selected day',
      now: '2027-03-27T12:00:00+01:00',
      selected: '2027-03-28T00:00:00+01:00',
      expiresAt: '2027-03-28T13:00:00+02:00',
    },
    {
      name: 'autumn date retains its local clock across a 25-hour day',
      now: '2027-10-31T00:30:00+02:00',
      selected: '2027-11-01T00:00:00+01:00',
      expiresAt: '2027-11-01T00:30:00+01:00',
    },
    {
      name: 'maximum stays within the selected date when offsets differ',
      now: '2026-03-28T23:30:00+01:00',
      selected: '2027-03-29T00:00:00+02:00',
      expiresAt: '2027-03-29T00:30:00+02:00',
    },
    {
      name: 'a date beyond the provider maximum is unavailable',
      now: '2027-02-01T17:30:00+01:00',
      selected: '2028-02-02T00:00:00+01:00',
      expiresAt: null,
    },
  ])('$name', ({ now, selected, expiresAt, minimum }) => {
    const input = { now: Date.parse(now), selected: Date.parse(selected) };
    // The UI project gives import.meta.url a browser URL; the workspace
    // script's cwd supplies the real module for the isolated Node process.
    const moduleUrl = pathToFileURL(
      resolve('app/features/settings/api-keys/lib/expiry.ts'),
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        resolve('backend/node-loader.mjs'),
        '--input-type=module',
        '-e',
        `import { expirySeconds, customExpiryBounds } from ${JSON.stringify(moduleUrl)};
         const { now, selected } = ${JSON.stringify(input)};
         const seconds = expirySeconds('custom', selected, now);
         console.log(JSON.stringify({
           seconds: seconds ?? null,
           expiresAt: seconds === undefined ? null : now + seconds * 1000,
           minimum: customExpiryBounds(now).minDate,
         }));`,
      ],
      {
        env: { ...process.env, TZ: 'Europe/Zurich' },
        encoding: 'utf8',
        timeout: 5000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout);
    expect(result.expiresAt).toBe(
      expiresAt === null ? null : Date.parse(expiresAt),
    );
    if (expiresAt !== null) {
      expect(result.seconds).toBeGreaterThanOrEqual(86_400);
      expect(result.seconds).toBeLessThanOrEqual(31_536_000);
    }
    if (minimum) expect(result.minimum).toBe(Date.parse(minimum));
  });
});
