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
 * - `scanHeartbeatAt` — while the row reads `scanning`, when its scan last
 *   showed life: the corpus claim's own timestamp, which every link of a
 *   running scan refreshes, copied over by each row sync (and stamped when a
 *   scan is queued). It is what tells a scan that runs for hours from one
 *   that crashed; cleared whenever the row is not scanning.
 * - `scanResumes` — how often the scan the row is in was picked up again
 *   after it stopped without a successor (see below); cleared when that
 *   scan ends, either way.
 *
 * ## A scan that stops without ending
 *
 * A scan is a chain of jobs: each link queues the next before its own job
 * ends, so a running scan always has a job queued or active (for a site
 * that was just added, the register job that queues its first link stands
 * in until it does: `domains/websites/scan-queue.ts`). A link cut off
 * mid-flight — the process was restarted, deployed over, or killed — leaves
 * none, and nothing records an end: the corpus claim stays held and the row
 * reads `scanning`. Before this was told apart, such a site sat there for
 * {@link STUCK_SCANNING_RETRY_MS} with no way to retry it, on every deploy
 * that met a scan in progress, and then started over from its first page.
 * The scheduler now resumes it: it takes the dead claim over by its
 * heartbeat and continues from the pages the scan had not reached
 * ({@link mayResumeScan}, {@link resumedScanEpoch}). A link's job ends
 * with its process: the process fails it on the way out, or, when it was
 * killed, its heartbeat stops and the supervisor fails it within two
 * minutes. Either way the scan is resumed on the next tick. A process that
 * only stalled may still be running the link whose job was failed; that
 * link cannot queue its successor, because the scan host checks that its
 * own job is still active before it does (`domains/websites/service.ts`),
 * so no second chain grows beside the resumed one. When no job is left to
 * say how the scan stopped, the claim is taken over only once it is older
 * than a link can hold it ({@link LINK_LIFETIME_MS}); every link refreshes
 * it when it starts, so a claim that old belongs to no running link.
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

/** How often one scan is picked up again after it stopped without a
 * successor. Bounded so that a scan which takes its process down with it
 * cannot do so every few minutes: past this the claim's own takeover window
 * ({@link STUCK_SCANNING_RETRY_MS}) is the retry, as it was before. */
export const MAX_SCAN_RESUMES = 3;

/** How long one link of a scan may hold the claim: the `websites.scan` job's
 * expiry (`jobs/tasks.ts`; a test holds the two equal). Every link refreshes
 * the claim when it starts and when it ends, so a claim older than this
 * belongs to no link that is still running. */
export const LINK_LIFETIME_MS = 15 * 60 * 1000;

/** How long a scan whose last job ran out its whole expiry is left alone.
 * Such a job ended in one of two ways, and the queue cannot tell which: its
 * process was killed and the job timed out, or the link is simply slow — it
 * outlived the job and is still working, and will queue its own successor.
 * Waiting this long after the job's end lets the second case finish before
 * the first is assumed. A job cut short before its expiry (a restart) has no
 * such doubt and is resumed on the next tick. */
export const EXPIRED_LINK_GRACE_MS = 15 * 60 * 1000;

/** The row's error when its domain has no corpus registration — written by
 * the status sync AND by a scan that finds nothing to claim, so the failure
 * ledger (attempt clock, `error` status) fires for that class too instead
 * of the scheduler re-picking the domain every tick in silence. */
export const WEBSITE_NOT_IN_CORPUS_MESSAGE =
  'Website not found in crawler. Please delete and re-add it.';

/** How a scan's error opens when the organization's embedding model could
 * not embed its pages (a rejected credential, an exhausted balance, a
 * provider that is down). The Websites page reads it to say so, and whom to
 * ask, instead of the provider's bare words. */
export const WEBSITE_EMBEDDING_FAILED_PREFIX =
  'The embedding model could not embed the pages';

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
  /** When a `scanning` row's scan last showed life (see the module note). */
  readonly scanHeartbeatAt?: number;
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
    // A row stuck in `scanning` beyond the window belongs to a crashed scan;
    // the corpus-side claim takeover decides. "Stuck" is measured from the
    // scan's own heartbeat when the row carries one. Measured from the last
    // COMPLETED scan alone, every rescan of a site whose interval exceeds the
    // window read as stuck from its first minute: it was queued again on
    // every tick for as long as it ran, each time only to find the claim
    // held, and those no-ops used up the tick's five starts ahead of the
    // sites that were really due.
    const alive = latestOf(anchor, site.scanHeartbeatAt);
    return now - (alive ?? site.createdAt) > STUCK_SCANNING_RETRY_MS;
  }

  if (anchor === undefined) return true;
  const intervalMs = site.scanIntervalSeconds * 1000;
  const window =
    site.lastAttemptAt === undefined
      ? intervalMs
      : Math.min(intervalMs, FAILED_SCAN_RETRY_MS);
  return now - anchor > window;
}

/** What the scheduler knows about a `scanning` row whose scan has no job
 * queued or running. */
export interface InterruptedScan {
  /** How often this scan was resumed already (`scanResumes`). */
  readonly resumes: number;
  /** How the domain's most recent failed scan job came to its end, when the
   * queue still holds one: when, and whether it ran out its whole expiry. */
  readonly lastFailedJob: {
    readonly endedAt: number;
    readonly ranOutItsExpiry: boolean;
  } | null;
  /** How long ago the corpus claim was last refreshed. */
  readonly claimAgeMs: number;
}

/** Whether an interrupted scan is resumed at `now` (see the module note). */
export function mayResumeScan(scan: InterruptedScan, now: number): boolean {
  if (scan.resumes >= MAX_SCAN_RESUMES) return false;
  const job = scan.lastFailedJob;
  if (job === null) return scan.claimAgeMs >= LINK_LIFETIME_MS;
  if (job.ranOutItsExpiry) return now - job.endedAt >= EXPIRED_LINK_GRACE_MS;
  return true;
}

/**
 * The instant a resumed scan counts its pages from: a page crawled since
 * then is done for this scan, every other one is still due. That is where
 * the interrupted scan began (`cycleStartedAt`, the first scan job since the
 * site's last finished scan) — so a restart costs the pages in flight, not
 * the hours already crawled — but never further back than one scan
 * interval: a page older than that is due on any scan. Null when nothing is
 * known about the scan's beginning; the resumed scan then starts afresh.
 */
export function resumedScanEpoch(
  scan: { cycleStartedAt: number | null; scanIntervalSeconds: number },
  now: number,
): number | null {
  if (scan.cycleStartedAt === null || scan.cycleStartedAt > now) return null;
  return Math.max(scan.cycleStartedAt, now - scan.scanIntervalSeconds * 1000);
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

/** When a `scanning` row's scan last showed life, or `null` when the row
 * carries no heartbeat. */
export function scanHeartbeatAt(
  metadata: Record<string, unknown> | undefined,
): number | null {
  const raw = metadata?.scanHeartbeatAt;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

/** How often the scan the row is in was resumed after stopping without a
 * successor. */
export function scanResumeCount(
  metadata: Record<string, unknown> | undefined,
): number {
  const raw = metadata?.scanResumes;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
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
