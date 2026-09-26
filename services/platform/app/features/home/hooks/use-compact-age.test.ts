import { describe, expect, it } from 'vitest';

import { formatCompactAge } from './use-compact-age';

const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();
const MINUTE = 60_000;

describe('formatCompactAge', () => {
  it('reads as a short age within the week', () => {
    expect(formatCompactAge(NOW - 20_000, NOW, 'en')).toBe('now');
    expect(formatCompactAge(NOW - 5 * MINUTE, NOW, 'en')).toBe('5m');
    expect(formatCompactAge(NOW - 3 * 60 * MINUTE, NOW, 'en')).toBe('3h');
    expect(formatCompactAge(NOW - 2 * 24 * 60 * MINUTE, NOW, 'en')).toBe('2d');
  });

  it('switches to the date after a week', () => {
    const tenDaysAgo = NOW - 10 * 24 * 60 * MINUTE;
    expect(formatCompactAge(tenDaysAgo, NOW, 'en')).toBe('Sep 13');
  });

  it('abbreviates the way each locale does', () => {
    // The narrow unit is the runtime's own locale data, and that data moves
    // between builds (German reads "3 Std." under one ICU, "3h" under
    // another) — so pin that the locale reaches Intl, not a literal.
    const narrowHours = new Intl.NumberFormat('de', {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'narrow',
    }).format(3);
    expect(formatCompactAge(NOW - 3 * 60 * MINUTE, NOW, 'de')).toBe(
      narrowHours,
    );
    // English would read "now".
    expect(formatCompactAge(NOW - 20_000, NOW, 'de')).toBe('jetzt');
  });

  it('never reads a future timestamp as negative', () => {
    expect(formatCompactAge(NOW + 5 * MINUTE, NOW, 'en')).toBe('now');
  });
});
