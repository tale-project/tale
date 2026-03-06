import { describe, it, expect } from 'vitest';

import { getPollingInterval } from '../internal_actions';

const MINUTE = 60 * 1000;

describe('getPollingInterval', () => {
  it('returns 2 minutes for first 30 attempts', () => {
    expect(getPollingInterval(0)).toBe(2 * MINUTE);
    expect(getPollingInterval(1)).toBe(2 * MINUTE);
    expect(getPollingInterval(15)).toBe(2 * MINUTE);
    expect(getPollingInterval(29)).toBe(2 * MINUTE);
  });

  it('returns progressive backoff after attempt 30', () => {
    expect(getPollingInterval(30)).toBe(15 * MINUTE);
    expect(getPollingInterval(31)).toBe(21 * MINUTE);
    expect(getPollingInterval(40)).toBe(75 * MINUTE);
    expect(getPollingInterval(50)).toBe(135 * MINUTE);
  });

  it('always returns a positive number', () => {
    for (let i = 0; i <= 60; i++) {
      expect(getPollingInterval(i)).toBeGreaterThan(0);
    }
  });
});
