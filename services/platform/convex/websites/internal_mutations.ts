import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { writeNotificationForOrgs } from '../notifications/helpers';
import * as WebsitesHelpers from './helpers';
import {
  CONNECTION_FAILURES_BEFORE_PAUSE,
  connectionFailureCount,
  scanPausedAt,
} from './scan_scheduling';
import {
  isValidScanInterval,
  SCAN_INTERVAL_VALUES,
  websiteKindValidator,
  websiteStatusValidator,
} from './validators';

// Every website write funnels through `provisionWebsite`/`patchWebsite`, so
// guarding the scan interval here rejects an out-of-enum value from any caller
// (REST, the agent write tool, the Convex actions) before it is stored and
// silently crawled at the 6h default. The DB column stays `v.string()`, so no
// migration is needed — the guard is a runtime check, not a schema change.
function assertScanInterval(scanInterval: string): void {
  if (!isValidScanInterval(scanInterval)) {
    throw new AppError({
      code: 'INVALID_SCAN_INTERVAL',
      scanInterval,
      allowed: [...SCAN_INTERVAL_VALUES],
    });
  }
}

export const provisionWebsite = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    kind: v.optional(websiteKindValidator),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.string(),
    status: v.optional(websiteStatusValidator),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    assertScanInterval(args.scanInterval);
    return await WebsitesHelpers.createWebsite(ctx, args);
  },
});

export const deleteWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await WebsitesHelpers.deleteWebsite(ctx, args.websiteId);
  },
});

/**
 * Record a failed scan on the organization's `websites` row — the store that
 * stays reachable when the corpus database itself is the problem (the crawl
 * engine's own failure marker lives in that corpus, so for connection-class
 * failures this row is the ONLY record; see TALE-PROJECT-106).
 *
 * Every failure stamps `metadata.lastScanAttemptAt`, which is what backs the
 * scheduler off to the bounded retry window instead of re-queueing the domain
 * on every five-minute tick. `corpusUnreachable` failures additionally count
 * toward the pause threshold; a reachable-but-failed scan resets the streak
 * (the database answered, so the configuration is not the problem). Crossing
 * the threshold pauses the site's scans and notifies the org's admins —
 * once per incident: a site that is already paused never re-notifies until
 * someone resumes it.
 */
export const recordScanFailure = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
    message: v.string(),
    // The corpus database could not be reached at all (bad credential, DNS,
    // refused) — a configuration problem, not a flaky page or provider.
    corpusUnreachable: v.boolean(),
  },
  returns: v.object({ paused: v.boolean() }),
  handler: async (ctx, args) => {
    const website = await WebsitesHelpers.getWebsiteByDomain(ctx, {
      organizationId: args.organizationId,
      domain: args.domain,
    });
    if (!website || website.status === 'deleting') return { paused: false };

    const failures = args.corpusUnreachable
      ? connectionFailureCount(website.metadata) + 1
      : 0;
    const alreadyPaused = scanPausedAt(website.metadata) !== null;
    const pauseNow =
      args.corpusUnreachable &&
      !alreadyPaused &&
      failures >= CONNECTION_FAILURES_BEFORE_PAUSE;
    const now = Date.now();

    await WebsitesHelpers.updateWebsite(ctx, {
      websiteId: website._id,
      status: 'error',
      metadata: {
        lastSyncError: args.message.slice(0, 1000),
        lastScanAttemptAt: now,
        // Cleared with null, never undefined: undefined would not survive
        // serialization and the metadata merge would keep the stale value.
        corpusConnectionFailures: failures > 0 ? failures : null,
        ...(pauseNow ? { scanPausedAt: now } : {}),
      },
    });

    if (pauseNow) {
      await writeNotificationForOrgs(ctx, {
        organizationIds: [args.organizationId],
        category: 'security',
        severity: 'warning',
        // Resolved client-side against the `notifications` i18n namespace;
        // the Slack sink renders the mirrored strings in
        // notification_messages.ts.
        titleKey: 'websiteScanPaused',
        bodyKey: 'websiteScanPausedDetails',
        params: { domain: args.domain, failures },
      });
    }
    return { paused: pauseNow };
  },
});

/**
 * Clear the failure bookkeeping after a scan completed: the site leaves the
 * bounded failure-retry cadence and returns to its own interval. Also clears
 * a pause — a scan can only have run past a pause when an admin resumed it
 * or an already-queued attempt succeeded, and either way a completed scan
 * proves the connection works again.
 */
export const clearScanFailures = internalMutation({
  args: {
    organizationId: v.string(),
    domain: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const website = await WebsitesHelpers.getWebsiteByDomain(ctx, {
      organizationId: args.organizationId,
      domain: args.domain,
    });
    if (!website) return null;
    const metadata = website.metadata ?? {};
    const dirty =
      metadata.lastScanAttemptAt != null ||
      metadata.corpusConnectionFailures != null ||
      metadata.scanPausedAt != null;
    if (!dirty) return null;
    await WebsitesHelpers.updateWebsite(ctx, {
      websiteId: website._id,
      metadata: {
        lastScanAttemptAt: null,
        corpusConnectionFailures: null,
        scanPausedAt: null,
      },
    });
    return null;
  },
});

export const patchWebsite = internalMutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    kind: v.optional(websiteKindValidator),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    lastScannedAt: v.optional(v.number()),
    status: v.optional(websiteStatusValidator),
    pageCount: v.optional(v.number()),
    crawledPageCount: v.optional(v.number()),
    metadata: v.optional(jsonRecordValidator),
    // Caller's org — when set, updateWebsite rejects a target row in another
    // tenant. REST handlers + the agent website_write tool MUST pass this.
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.scanInterval !== undefined) {
      assertScanInterval(args.scanInterval);
    }
    return await WebsitesHelpers.updateWebsite(ctx, args);
  },
});
