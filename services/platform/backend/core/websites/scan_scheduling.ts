/**
 * The scan-scheduling policy: when a registered website is due for a crawl,
 * and how repeated failures slow it down and eventually pause it.
 *
 * Pure and runtime-agnostic on purpose — the five-minute scheduler action
 * (`knowledge/crawl_action.scanDueWebsites`, node) and the websites
 * queries/mutations (V8) both import it, and the tests exercise the policy
 * without either runtime.
 *
 * ## Failure bookkeeping lives on the Convex row's `metadata`
 *
 * A scan that cannot reach the organization's knowledge database has exactly
 * one reachable store left: the Convex `websites` row. Recording failures
 * there (instead of the corpus, which is what failed) is what makes them
 * visible at all — TALE-PROJECT-106 was three weeks of an invalid corpus
 * credential failing on schedule with zero signal, because every record of
 * the failure was written into the database that was down.
 *
 * The fields are plain `metadata` keys, not schema columns, so no schema
 * change ships with them; a cleared field is written as `null` (the
 * `updateWebsite` metadata merge drops nothing, and `undefined` would not
 * survive serialization).
 *
 * - `lastScanAttemptAt` — when the last FAILED scan attempt ran. Present only
 *   while the site is failing (cleared on success); its presence switches the
 *   retry cadence from the site's own interval to the bounded
 *   {@link FAILED_SCAN_RETRY_MS} window, so a failing site neither storms the
 *   scheduler every tick nor waits out a 30-day interval to try again.
 * - `corpusConnectionFailures` — consecutive attempts that could not REACH
 *   the corpus database (auth, DNS, refused). A reachable-but-failing scan
 *   resets it; {@link CONNECTION_FAILURES_BEFORE_PAUSE} of them in a row mean
 *   the organization's knowledge-database configuration is broken, not
 *   flaky.
 * - `scanPausedAt` — set when the failure streak hits the threshold. A paused
 *   site is never due; org admins are notified once, and scanning stays off
 *   until someone fixes the connection and resumes it from the Websites page.
 */

/** Retry cadence while a site's scans are failing: `min(interval, this)`.
 * Bounded so a 30-day site still retries (and can reach the pause threshold)
 * promptly, and floored by the interval so a 1-hour site is not retried more
 * often than it would be scanned. */
export const FAILED_SCAN_RETRY_MS = 2 * 60 * 60 * 1000;

/** Consecutive connection-class failures before the site's scans pause and
 * its org admins are notified. Combined with {@link FAILED_SCAN_RETRY_MS}
 * this pauses a broken configuration within ~6 hours of the first failure. */
export const CONNECTION_FAILURES_BEFORE_PAUSE = 3;

/** A Convex row stuck in `scanning` longer than this belongs to a crashed
 * scan; the corpus-side claim takeover makes the retry safe. */
export const STUCK_SCANNING_RETRY_MS = 2 * 60 * 60 * 1000;

/** The row's error when its domain has no corpus registration — written by
 * the status sync AND by a scan that finds nothing to claim, so the failure
 * ledger (attempt clock, `error` status) fires for that class too instead
 * of the scheduler re-picking the domain every tick in silence. */
export const WEBSITE_NOT_IN_CORPUS_MESSAGE =
  'Website not found in crawler. Please delete and re-add it.';

/** The scheduler's view of one `websites` row, as
 * `listWebsitesForScanScheduling` projects it. */
export interface ScanSchedulingSite {
  readonly scanIntervalSeconds: number;
  readonly lastScannedAt?: number;
  readonly lastAttemptAt?: number;
  readonly status?: string;
  readonly createdAt: number;
  readonly connectionFailures: number;
  readonly scanPaused: boolean;
}

/**
 * Whether one website is due for a scan at `now`.
 *
 * The anchor for every window is the LATEST scan activity — a successful
 * scan's `lastScannedAt` or a failed attempt's `lastAttemptAt`. Anchoring
 * failures too is the backoff: before it, a row whose scans kept failing
 * never advanced its clock and was re-queued on every five-minute tick,
 * forever.
 */
export function isDueForScan(site: ScanSchedulingSite, now: number): boolean {
  if (site.scanPaused) return false;
  if (site.status === 'deleting') return false;

  const anchor = latestOf(site.lastScannedAt, site.lastAttemptAt);

  if (site.status === 'scanning') {
    // A healthy scan refreshes its corpus claim, not the Convex row — treat
    // a row stuck in `scanning` beyond the window as crashed and let the
    // corpus-side claim takeover decide.
    return now - (anchor ?? site.createdAt) > STUCK_SCANNING_RETRY_MS;
  }

  if (anchor === undefined) return true;
  const intervalMs = site.scanIntervalSeconds * 1000;
  const window =
    site.lastAttemptAt === undefined
      ? intervalMs
      : Math.min(intervalMs, FAILED_SCAN_RETRY_MS);
  return now - anchor > window;
}

function latestOf(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

// ------------------------------------------------ metadata field accessors

/** Consecutive connection-class scan failures recorded on the row. */
export function connectionFailureCount(
  metadata: Record<string, unknown> | undefined,
): number {
  const raw = metadata?.corpusConnectionFailures;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/** When the last failed scan attempt ran, or `null` when the site is not in
 * a failure streak (the field is cleared on success). */
export function lastScanAttemptAt(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const raw = metadata?.lastScanAttemptAt;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

/** When the site's scans were paused, or `null` while scanning is active. */
export function scanPausedAt(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const raw = metadata?.scanPausedAt;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}
