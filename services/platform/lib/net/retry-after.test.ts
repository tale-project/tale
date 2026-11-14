import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseRetryAfterMs } from './retry-after';

describe('parseRetryAfterMs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the delta-seconds form as milliseconds', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
    expect(parseRetryAfterMs(' 0 ')).toBe(0);
  });

  it('reads the HTTP-date form as the time left until it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
    expect(parseRetryAfterMs('Sat, 14 Nov 2026 10:01:30 GMT')).toBe(90_000);
  });

  it('gives nothing for a date already past, a negative delta or no value', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
    expect(parseRetryAfterMs('Sat, 14 Nov 2026 09:00:00 GMT')).toBeUndefined();
    expect(parseRetryAfterMs('-5')).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
  });

  it('gives nothing for a value that is neither form', () => {
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });
});
