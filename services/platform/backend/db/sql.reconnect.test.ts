// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const { postgres } = vi.hoisted(() => ({ postgres: vi.fn(() => ({})) }));
vi.mock('postgres', () => ({ default: postgres }));

import { createSql, reconnectBackoffSeconds } from './sql.ts';

/**
 * postgres.js reconnects a dropped connection after a backoff that climbs to
 * twenty seconds and counts the whole pool's failures, so a few seconds of
 * restart left the pool waiting long after the database was back. The pool
 * is opened with a ceiling of two seconds instead.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reconnectBackoffSeconds', () => {
  it('starts as postgres.js’s own backoff does, within its jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    // 3 ** retries hundredths of a second: 1 ms ... 0.27 s ... 0.81 s ...
    expect(reconnectBackoffSeconds(0)).toBeCloseTo(0.01, 5);
    expect(reconnectBackoffSeconds(3)).toBeCloseTo(0.27, 5);
    expect(reconnectBackoffSeconds(4)).toBeCloseTo(0.81, 5);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(reconnectBackoffSeconds(4)).toBeCloseTo(0.405, 5);
  });

  it('never waits longer than two seconds, whatever the pool’s retry count', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    for (const retries of [5, 6, 7, 20, 400]) {
      expect(reconnectBackoffSeconds(retries)).toBeLessThanOrEqual(2);
    }
    // postgres.js's default reaches ten to twenty seconds from here.
    expect(reconnectBackoffSeconds(7)).toBe(2);
  });

  it('keeps a jittered floor, so a pool’s reconnects are spread', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(reconnectBackoffSeconds(10)).toBe(1);
  });
});

describe('createSql', () => {
  it('opens the pool with that backoff', () => {
    createSql('postgresql://tale:pw@127.0.0.1:5432/tale_app');

    expect(postgres).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ backoff: reconnectBackoffSeconds }),
    );
  });
});
