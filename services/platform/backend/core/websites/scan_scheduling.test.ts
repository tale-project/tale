import { describe, expect, it } from 'vitest';

import {
  CONNECTION_FAILURES_BEFORE_PAUSE,
  connectionFailureCount,
  FAILED_SCAN_RETRY_MS,
  isDueForScan,
  lastScanAttemptAt,
  scanPausedAt,
  STUCK_SCANNING_RETRY_MS,
  type ScanSchedulingSite,
} from './scan_scheduling';

/**
 * The regression locked here is TALE-PROJECT-106: a site whose scans kept
 * failing (an invalid corpus credential) never advanced any clock the
 * scheduler reads, so every five-minute tick re-queued it — for three weeks,
 * with no cap and no signal. The policy now anchors on the last ATTEMPT, not
 * only the last success, retries failures on a bounded window, and stops
 * entirely once the site is paused.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = 1_756_000_000_000;

function site(overrides: Partial<ScanSchedulingSite>): ScanSchedulingSite {
  return {
    scanIntervalSeconds: 6 * 3600,
    createdAt: NOW - 30 * 24 * HOUR,
    connectionFailures: 0,
    scanPaused: false,
    ...overrides,
  };
}

describe('interval scheduling', () => {
  it('a never-scanned site is due immediately', () => {
    expect(isDueForScan(site({}), NOW)).toBe(true);
  });

  it('a healthy site is due after its interval, not before', () => {
    const healthy = site({ lastScannedAt: NOW - 5 * HOUR });
    expect(isDueForScan(healthy, NOW)).toBe(false);
    expect(isDueForScan(site({ lastScannedAt: NOW - 7 * HOUR }), NOW)).toBe(
      true,
    );
  });

  it('a site being deleted is never due', () => {
    expect(isDueForScan(site({ status: 'deleting' }), NOW)).toBe(false);
  });
});

describe('failure backoff (the TALE-PROJECT-106 regression)', () => {
  it('a failed attempt is NOT re-queued on the next tick', () => {
    // Before the fix a failing site's clock never advanced, so the very
    // next five-minute tick re-queued it, forever (~10 uncaught errors a
    // day for three weeks on the demo org).
    const failing = site({
      status: 'error',
      lastScannedAt: NOW - 20 * 24 * HOUR,
      lastAttemptAt: NOW - 5 * MINUTE,
      connectionFailures: 1,
    });
    expect(isDueForScan(failing, NOW)).toBe(false);
  });

  it('a failing site retries on the bounded window, not its own interval', () => {
    // A 30-day site must not wait 30 days between failure retries — it
    // would take a quarter to reach the pause threshold.
    const monthly = site({
      scanIntervalSeconds: 30 * 24 * 3600,
      status: 'error',
      lastAttemptAt: NOW - FAILED_SCAN_RETRY_MS - MINUTE,
      connectionFailures: 1,
    });
    expect(isDueForScan(monthly, NOW)).toBe(true);
  });

  it('a short interval floors the failure retry window', () => {
    // An hourly site keeps retrying hourly — the bound only ever slows
    // sites down relative to their interval, never speeds them up past it.
    const hourly = site({
      scanIntervalSeconds: 3600,
      status: 'error',
      lastAttemptAt: NOW - 90 * MINUTE,
      connectionFailures: 1,
    });
    expect(isDueForScan(hourly, NOW)).toBe(true);
    expect(
      isDueForScan({ ...hourly, lastAttemptAt: NOW - 30 * MINUTE }, NOW),
    ).toBe(false);
  });

  it('a paused site is never due, no matter how overdue', () => {
    const paused = site({
      status: 'error',
      lastScannedAt: NOW - 365 * 24 * HOUR,
      lastAttemptAt: NOW - 365 * 24 * HOUR,
      connectionFailures: CONNECTION_FAILURES_BEFORE_PAUSE,
      scanPaused: true,
    });
    expect(isDueForScan(paused, NOW)).toBe(false);
  });
});

describe('stuck-scanning takeover', () => {
  it('a row stuck in scanning is retried only after the takeover window', () => {
    const stuck = site({
      status: 'scanning',
      lastScannedAt: NOW - STUCK_SCANNING_RETRY_MS - MINUTE,
    });
    expect(isDueForScan(stuck, NOW)).toBe(true);
    expect(
      isDueForScan(
        site({ status: 'scanning', lastScannedAt: NOW - HOUR }),
        NOW,
      ),
    ).toBe(false);
  });

  it('a failed attempt re-arms the takeover window too', () => {
    // A scanning row whose last ATTEMPT just failed must not be re-queued
    // every tick while the corpus-side claim is still fresh.
    const stuck = site({
      status: 'scanning',
      lastScannedAt: NOW - 3 * STUCK_SCANNING_RETRY_MS,
      lastAttemptAt: NOW - 5 * MINUTE,
    });
    expect(isDueForScan(stuck, NOW)).toBe(false);
  });

  it('a scanning row with no activity at all falls back to its creation time', () => {
    expect(
      isDueForScan(
        site({
          status: 'scanning',
          createdAt: NOW - STUCK_SCANNING_RETRY_MS - MINUTE,
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe('metadata accessors', () => {
  it('read valid values', () => {
    expect(
      connectionFailureCount({ corpusConnectionFailures: 2, other: 'x' }),
    ).toBe(2);
    expect(lastScanAttemptAt({ lastScanAttemptAt: NOW })).toBe(NOW);
    expect(scanPausedAt({ scanPausedAt: NOW })).toBe(NOW);
  });

  it('treat cleared (null), absent, and junk values as not set', () => {
    for (const metadata of [
      undefined,
      {},
      {
        corpusConnectionFailures: null,
        lastScanAttemptAt: null,
        scanPausedAt: null,
      },
      {
        corpusConnectionFailures: 'three',
        lastScanAttemptAt: 'yesterday',
        scanPausedAt: true,
      },
      {
        corpusConnectionFailures: -1,
        lastScanAttemptAt: Number.NaN,
        scanPausedAt: 0,
      },
    ]) {
      expect(connectionFailureCount(metadata)).toBe(0);
      expect(lastScanAttemptAt(metadata)).toBeNull();
      expect(scanPausedAt(metadata)).toBeNull();
    }
  });
});
