import { describe, expect, it } from 'vitest';

import {
  CONNECTION_FAILURES_BEFORE_PAUSE,
  connectionFailureCount,
  EXPIRED_LINK_GRACE_MS,
  FAILED_SCAN_RETRY_MS,
  isDueForScan,
  lastScanAttemptAt,
  MAX_SCAN_RESUMES,
  mayResumeScan,
  resumedScanEpoch,
  scanHeartbeatAt,
  scanPausedAt,
  scanResumeCount,
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

  // Regression: "stuck" was measured from the last COMPLETED scan alone, so
  // every rescan of a site whose interval exceeds the window read as stuck
  // from its first minute. It was queued again on every five-minute tick for
  // as long as it ran, each time only to find the claim held, and those
  // no-ops took the tick's five starts ahead of the sites really due.
  it('a rescan that shows life is not stuck, however old the last completed scan', () => {
    const running = site({
      status: 'scanning',
      lastScannedAt: NOW - 6 * HOUR,
      scanHeartbeatAt: NOW - 5 * MINUTE,
    });
    expect(isDueForScan(running, NOW)).toBe(false);
  });

  it('a scan whose heartbeat stopped is taken over after the window', () => {
    const crashed = site({
      status: 'scanning',
      lastScannedAt: NOW - 6 * HOUR,
      scanHeartbeatAt: NOW - STUCK_SCANNING_RETRY_MS - MINUTE,
    });
    expect(isDueForScan(crashed, NOW)).toBe(true);
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

/**
 * A scan cut off by a restart left its row on `scanning` for the whole
 * takeover window — two hours, on every deploy that met a scan in progress —
 * and then began again from its first page. The scheduler now resumes it;
 * these are the two judgments it makes.
 */
describe('resuming an interrupted scan', () => {
  it('resumes a scan whose last job was cut short, at once', () => {
    expect(
      mayResumeScan(
        {
          resumes: 0,
          lastFailedJob: { endedAt: NOW - 1000, ranOutItsExpiry: false },
        },
        NOW,
      ),
    ).toBe(true);
    expect(mayResumeScan({ resumes: 0, lastFailedJob: null }, NOW)).toBe(true);
  });

  // The job's end does not say whether its process died or the link is
  // merely slow and still working; a slow link queues its own successor.
  it('leaves a scan whose last job ran out its expiry alone for the grace', () => {
    const ranOut = (endedAt: number) => ({
      resumes: 0,
      lastFailedJob: { endedAt, ranOutItsExpiry: true },
    });
    expect(mayResumeScan(ranOut(NOW - MINUTE), NOW)).toBe(false);
    expect(mayResumeScan(ranOut(NOW - EXPIRED_LINK_GRACE_MS + 1), NOW)).toBe(
      false,
    );
    expect(mayResumeScan(ranOut(NOW - EXPIRED_LINK_GRACE_MS), NOW)).toBe(true);
  });

  // A scan that takes its process down would otherwise do so on every tick.
  it('stops resuming one scan after the limit', () => {
    expect(
      mayResumeScan(
        { resumes: MAX_SCAN_RESUMES - 1, lastFailedJob: null },
        NOW,
      ),
    ).toBe(true);
    expect(
      mayResumeScan({ resumes: MAX_SCAN_RESUMES, lastFailedJob: null }, NOW),
    ).toBe(false);
  });

  it('counts pages from where the interrupted scan began', () => {
    expect(
      resumedScanEpoch(
        { cycleStartedAt: NOW - 2 * HOUR, scanIntervalSeconds: 6 * 3600 },
        NOW,
      ),
    ).toBe(NOW - 2 * HOUR);
  });

  it('never counts a page older than one interval as done', () => {
    expect(
      resumedScanEpoch(
        { cycleStartedAt: NOW - 9 * HOUR, scanIntervalSeconds: 6 * 3600 },
        NOW,
      ),
    ).toBe(NOW - 6 * HOUR);
  });

  it('starts afresh when the beginning is unknown or lies ahead', () => {
    expect(
      resumedScanEpoch(
        { cycleStartedAt: null, scanIntervalSeconds: 6 * 3600 },
        NOW,
      ),
    ).toBeNull();
    expect(
      resumedScanEpoch(
        { cycleStartedAt: NOW + MINUTE, scanIntervalSeconds: 6 * 3600 },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('metadata accessors', () => {
  it('reads the resume count and treats anything else as none', () => {
    expect(scanResumeCount({ scanResumes: 2 })).toBe(2);
    expect(scanResumeCount({ scanResumes: null })).toBe(0);
    expect(scanResumeCount({ scanResumes: 'two' })).toBe(0);
    expect(scanResumeCount(undefined)).toBe(0);
  });

  it('reads the scan heartbeat and treats a cleared one as absent', () => {
    expect(scanHeartbeatAt({ scanHeartbeatAt: NOW })).toBe(NOW);
    expect(scanHeartbeatAt({ scanHeartbeatAt: null })).toBeNull();
    expect(scanHeartbeatAt(undefined)).toBeNull();
  });

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
