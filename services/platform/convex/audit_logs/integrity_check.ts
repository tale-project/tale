/**
 * Scheduled audit-log integrity check (#1505).
 *
 * The hash-chain + checkpoint verification already exists as the admin-only
 * `verifyIntegrity` query, but until now it only ran when an admin opened the
 * audit-log page. SOC 2 / ISO 27001 expect *continuous* monitoring with
 * alerting, not an on-demand check. This module runs that same verification
 * across every org with an audit chain on a daily cron and raises an alert —
 * a structured `console.error`, a `security`-category audit row, AND an
 * out-of-band notification (in-app bell for admins + Slack fan-out) — whenever
 * a chain fails to verify, is truncated past the per-run window, mismatches a
 * checkpoint, or trusts an unsigned PII scrub. The out-of-band alert is what
 * makes this a *monitored* control (SOC 2 CC7.2/CC7.3): a console line alone
 * is not seen unless someone is watching the logs.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { writeNotificationForOrgs } from '../notifications/helpers';
import { verifyAuditChain } from './verify_integrity';

// Bound the per-run org fan-out so a deployment with a very large org count
// can't blow the action's time budget. Orgs are selected round-robin by
// staleness (see `selectOrgsForIntegrityRun`) so the ones not reached this
// run ARE reached on later runs — no org is permanently outside the control.
const MAX_ORGS_PER_RUN = 500;
// Cap the rows verified per org per run. The cron pages FORWARD across runs
// from each org's persisted cursor (`auditIntegrityProgress`), so a chain
// longer than this window is fully covered over successive runs rather than
// leaving its newest rows — where live tampering would land — unverified.
const MAX_ENTRIES_PER_ORG = 5000;

/**
 * Pick which orgs to verify this run. Every org has one `auditLogChainGenesis`
 * row; we rank them by their integrity-progress `updatedAt` (orgs never
 * checked, or checked longest ago, first) and take the stalest
 * `MAX_ORGS_PER_RUN`. Because each verified org's `updatedAt` is bumped to now,
 * it rotates to the back of the queue and the next run picks up the others —
 * so a deployment with more than `MAX_ORGS_PER_RUN` audited orgs covers all of
 * them across runs instead of re-checking the same first window forever
 * (#1846 item 1). Iterating one small row per org is cheap; the expensive part
 * is the per-org chain walk, which the cap bounds.
 */
export const selectOrgsForIntegrityRun = internalQuery({
  args: {},
  returns: v.object({
    organizationIds: v.array(v.string()),
    totalOrgs: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const lastCheckedByOrg = new Map<string, number>();
    for await (const row of ctx.db.query('auditIntegrityProgress')) {
      lastCheckedByOrg.set(row.organizationId, row.updatedAt);
    }

    // Never-checked orgs sort first (sentinel -1 < any real timestamp).
    const orgs: { organizationId: string; lastChecked: number }[] = [];
    for await (const row of ctx.db.query('auditLogChainGenesis')) {
      orgs.push({
        organizationId: row.organizationId,
        lastChecked: lastCheckedByOrg.get(row.organizationId) ?? -1,
      });
    }
    orgs.sort((a, b) => a.lastChecked - b.lastChecked);

    const organizationIds = orgs
      .slice(0, MAX_ORGS_PER_RUN)
      .map((o) => o.organizationId);
    return {
      organizationIds,
      totalOrgs: orgs.length,
      truncated: orgs.length > MAX_ORGS_PER_RUN,
    };
  },
});

/**
 * Unauthenticated chain verification for the cron, resuming from the org's
 * persisted progress cursor so each run pages FORWARD instead of re-walking
 * the oldest window (#1846 item 2). Access control is the function's
 * `internal` visibility (only schedulable/runnable from trusted server
 * contexts), not a per-call admin gate — the public `verifyIntegrity` query
 * keeps the admin gate for user-facing access.
 *
 * Returns the chain-verification result plus the `nextCursor` the action
 * should persist: advanced to the last verified row when this run made
 * progress, otherwise the unchanged cursor. `headReached` is true only when
 * the walk consumed the live chain without truncation.
 */
export const verifyAuditChainForOrg = internalQuery({
  args: {
    organizationId: v.string(),
    maxEntries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const progress = await ctx.db
      .query('auditIntegrityProgress')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    const result = await verifyAuditChain(ctx, {
      organizationId: args.organizationId,
      maxEntries: args.maxEntries,
      fromTimestamp: progress?.lastVerifiedTimestamp,
      afterId: progress?.lastVerifiedId,
      previousExpectedHash: progress?.previousExpectedHash,
    });

    // Advance the cursor to the last row verified this run; if nothing new was
    // verified (caught up, no new rows), keep the prior cursor. Never advance
    // past a detected break, so the next run re-hits and re-alerts it.
    const nextCursor = {
      lastVerifiedTimestamp:
        result.lastVerifiedTimestamp ?? progress?.lastVerifiedTimestamp,
      lastVerifiedId: result.lastVerifiedId ?? progress?.lastVerifiedId,
      previousExpectedHash:
        result.lastVerifiedHash ?? progress?.previousExpectedHash,
      headReached: result.valid && !result.truncated,
    };

    return { ...result, nextCursor };
  },
});

/**
 * Persist an org's integrity-check progress cursor. Upserts the per-org
 * `auditIntegrityProgress` row and bumps `updatedAt` so round-robin selection
 * rotates this org to the back of the queue. Its own internal mutation so the
 * action can record progress right after each verification without coupling it
 * to the (isolated) alert writes.
 */
export const recordIntegrityProgress = internalMutation({
  args: {
    organizationId: v.string(),
    lastVerifiedTimestamp: v.optional(v.number()),
    lastVerifiedId: v.optional(v.string()),
    previousExpectedHash: v.optional(v.string()),
    headReached: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('auditIntegrityProgress')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    const patch = {
      lastVerifiedTimestamp: args.lastVerifiedTimestamp,
      lastVerifiedId: args.lastVerifiedId,
      previousExpectedHash: args.previousExpectedHash,
      headReached: args.headReached,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('auditIntegrityProgress', {
        organizationId: args.organizationId,
        ...patch,
      });
    }
    return null;
  },
});

type IntegrityFindingKind = 'tampering' | 'config';

/**
 * Classify a failed verification so the alert is PROPORTIONATE. A checkpoint
 * that is *signed* but the deployment has *no signing key configured* (the
 * verifier's "no-key" verdict) is an operator/config gap — tamper-evidence
 * can't be verified, but it is NOT a detected forgery. A hash-chain break
 * (`firstBrokenAt`) or an outright signature mismatch IS a tamper signal.
 * Treating the benign config gap as "tampering detected" is exactly what made
 * a clean stack raise a scary `critical` alert; now it only ever fires for a
 * genuine break, and the config gap gets a calm, actionable `warning`.
 */
export function classifyIntegrityFinding(result: {
  firstBrokenAt?: { logId: string };
  checkpointMismatch?: { reason: string };
}): { kind: IntegrityFindingKind; reason: string } {
  if (result.checkpointMismatch && !result.firstBrokenAt) {
    const reason = result.checkpointMismatch.reason;
    // The verifier emits this exact phrasing for the no-key path — a signed
    // checkpoint with TALE_AUDIT_SIGNING_KEY absent. Config, not tampering.
    if (reason.includes('not configured')) {
      return { kind: 'config', reason };
    }
    return { kind: 'tampering', reason };
  }
  const reason = result.firstBrokenAt
    ? `hash chain broken at log ${result.firstBrokenAt.logId}`
    : 'audit log chain failed verification';
  return { kind: 'tampering', reason };
}

/**
 * Out-of-band alert for a failed integrity check: an in-app notification to
 * the org's admins (`security` category also fans out to Slack via
 * `writeNotificationForOrgs`). Kept as its own internal mutation so the
 * action can raise it right after writing the in-band audit row; a single
 * org's notification failing must not abort the sweep, so the action wraps
 * the call in its own try/catch.
 *
 * `kind` controls severity + copy: a genuine `tampering` finding is `critical`
 * ("investigate now"); a `config` gap is a calm `warning` ("set the signing
 * key") so a benign unverifiable-checkpoint state never reads as a breach.
 */
export const notifyIntegrityFailure = internalMutation({
  args: {
    organizationId: v.string(),
    reason: v.string(),
    kind: v.union(v.literal('tampering'), v.literal('config')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const isConfig = args.kind === 'config';
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: isConfig ? 'warning' : 'critical',
      // Resolved client-side against the `notifications` i18n namespace; the
      // Slack sink renders the mirrored strings in notification_messages.ts.
      titleKey: isConfig
        ? 'auditIntegrityUnverifiable'
        : 'auditIntegrityFailed',
      bodyKey: isConfig
        ? 'auditIntegrityUnverifiableDetails'
        : 'auditIntegrityFailedDetails',
      params: { reason: args.reason },
      link: { kind: 'audit-logs' },
    });
    return null;
  },
});

export const runAuditIntegrityCheck = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const { organizationIds, totalOrgs, truncated } = await ctx.runQuery(
      internal.audit_logs.integrity_check.selectOrgsForIntegrityRun,
      {},
    );
    if (truncated) {
      console.warn(
        `[AuditIntegrity] verifying the ${MAX_ORGS_PER_RUN} stalest of ${totalOrgs} orgs this run; the rest are picked up on the next daily run`,
      );
    }

    let failures = 0;
    let configIssues = 0;
    let errored = 0;
    for (const organizationId of organizationIds) {
      // One org's verification failing to run must not abort the sweep for
      // the rest — isolate each in its own try/catch.
      let result;
      try {
        result = await ctx.runQuery(
          internal.audit_logs.integrity_check.verifyAuditChainForOrg,
          { organizationId, maxEntries: MAX_ENTRIES_PER_ORG },
        );
      } catch (err) {
        errored++;
        console.error(
          `[AuditIntegrity] could not verify org ${organizationId}:`,
          err,
        );
        continue;
      }

      // Persist the paging cursor so the next run resumes where this one left
      // off (forward paging across runs, #1846 item 2) and this org rotates to
      // the back of the round-robin queue. Isolated try/catch so a failed
      // progress write never aborts the sweep — worst case the org re-walks
      // the same window next run.
      try {
        await ctx.runMutation(
          internal.audit_logs.integrity_check.recordIntegrityProgress,
          { organizationId, ...result.nextCursor },
        );
      } catch (err) {
        console.error(
          `[AuditIntegrity] could not record progress for org ${organizationId}:`,
          err,
        );
      }

      // `truncated` is a coverage limit, not tampering: the chain is longer
      // than the per-run window so the newest rows weren't reached this run.
      // The forward cursor above means they ARE reached on a later run.
      // Surface it (never silent) but do NOT treat it as a failure — and
      // never as `unsignedScrubCount`, which is only non-zero on deployments
      // with no signing key, where it is the expected legacy state.
      if (result.truncated) {
        console.warn(
          `[AuditIntegrity] org ${organizationId}: chain exceeds the ${MAX_ENTRIES_PER_ORG}-row window; verified ${result.verifiedCount} this run, resuming next run`,
        );
      }

      // The chain (or a checkpoint) failed to verify. `verifyAuditChain`
      // returns `valid: false` for both a hash break (`firstBrokenAt`) and a
      // checkpoint mismatch — but only a genuine break is "tampering". A signed
      // checkpoint with no key configured is a config gap (`config`), alerted
      // calmly so a clean stack never reads as a breach.
      if (result.valid) continue;

      const finding = classifyIntegrityFinding(result);
      const isTampering = finding.kind === 'tampering';
      if (isTampering) {
        failures++;
      } else {
        configIssues++;
      }

      // Operator-facing log line — surfaces in log-based alerting. A config
      // gap is a warning, not an error, so it doesn't trip error-rate alarms.
      const logLine = `[AuditIntegrity] ${
        isTampering ? 'FAILED' : 'UNVERIFIABLE'
      } for org ${organizationId}: ${finding.reason}`;
      const logDetail = result.firstBrokenAt ?? result.checkpointMismatch ?? {};
      if (isTampering) {
        console.error(logLine, logDetail);
      } else {
        console.warn(logLine, logDetail);
      }

      // In-band signal: a security-category audit row. It is itself a fresh,
      // correctly-chained entry, so it does not interfere with detection of
      // the existing break it reports.
      const metadata: Record<string, unknown> = {
        verifiedCount: result.verifiedCount,
        checkpointsVerified: result.checkpointsVerified,
        findingKind: finding.kind,
      };
      if (result.firstBrokenAt) metadata.firstBrokenAt = result.firstBrokenAt;
      if (result.checkpointMismatch) {
        metadata.checkpointMismatch = result.checkpointMismatch;
      }
      await ctx.runMutation(
        internal.audit_logs.internal_mutations.createAuditLog,
        {
          organizationId,
          actorId: 'system',
          actorType: 'system',
          action: isTampering
            ? 'audit_log.integrity_check_failed'
            : 'audit_log.integrity_unverifiable',
          category: 'security',
          resourceType: 'audit_log',
          status: 'failure',
          errorMessage: finding.reason,
          metadata,
        },
      );

      // Out-of-band alert (admins' notification bell + Slack). Isolated so a
      // notification write failing for one org never aborts the sweep — the
      // in-band audit row above is already persisted as the durable record.
      try {
        await ctx.runMutation(
          internal.audit_logs.integrity_check.notifyIntegrityFailure,
          { organizationId, reason: finding.reason, kind: finding.kind },
        );
      } catch (err) {
        console.error(
          `[AuditIntegrity] could not raise out-of-band alert for org ${organizationId}:`,
          err,
        );
      }
    }

    console.log(
      `[AuditIntegrity] checked ${organizationIds.length} org(s): ${failures} failing, ${configIssues} unverifiable (config), ${errored} errored`,
    );
    return null;
  },
});
