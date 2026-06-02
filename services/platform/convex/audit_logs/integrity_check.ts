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
// can't blow the action's time budget. Logged when hit so coverage gaps are
// never silent.
const MAX_ORGS_PER_RUN = 500;
// Cap the rows verified per org per run. `verifyAuditChain` reports
// `truncated` when it stops early, which the alert treats as a finding so a
// chain that outgrows this window is surfaced rather than silently
// half-checked.
const MAX_ENTRIES_PER_ORG = 5000;

/** Org ids that have ever written an audit log (one genesis row per org). */
export const listAuditedOrganizationIds = internalQuery({
  args: {},
  returns: v.object({
    organizationIds: v.array(v.string()),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    const organizationIds: string[] = [];
    let truncated = false;
    for await (const row of ctx.db.query('auditLogChainGenesis')) {
      if (organizationIds.length >= MAX_ORGS_PER_RUN) {
        truncated = true;
        break;
      }
      organizationIds.push(row.organizationId);
    }
    return { organizationIds, truncated };
  },
});

/**
 * Unauthenticated chain verification for the cron. Access control is the
 * function's `internal` visibility (only schedulable/runnable from trusted
 * server contexts), not a per-call admin gate — the public `verifyIntegrity`
 * query keeps the admin gate for user-facing access.
 */
export const verifyAuditChainForOrg = internalQuery({
  args: {
    organizationId: v.string(),
    maxEntries: v.optional(v.number()),
  },
  handler: async (ctx, args) => verifyAuditChain(ctx, args),
});

/**
 * Out-of-band alert for a failed integrity check: an in-app notification to
 * the org's admins (`security` category also fans out to Slack via
 * `writeNotificationForOrgs`). Kept as its own internal mutation so the
 * action can raise it right after writing the in-band audit row; a single
 * org's notification failing must not abort the sweep, so the action wraps
 * the call in its own try/catch.
 */
export const notifyIntegrityFailure = internalMutation({
  args: { organizationId: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'critical',
      // Resolved client-side against the `notifications` i18n namespace; the
      // Slack sink renders the mirrored strings in notification_messages.ts.
      titleKey: 'auditIntegrityFailed',
      bodyKey: 'auditIntegrityFailedDetails',
      params: { reason: args.reason },
    });
    return null;
  },
});

export const runAuditIntegrityCheck = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const { organizationIds, truncated } = await ctx.runQuery(
      internal.audit_logs.integrity_check.listAuditedOrganizationIds,
      {},
    );
    if (truncated) {
      console.warn(
        `[AuditIntegrity] org list capped at ${MAX_ORGS_PER_RUN}; remaining orgs are checked on the next daily run`,
      );
    }

    let failures = 0;
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

      // `truncated` is a coverage limit, not tampering: the chain is longer
      // than the per-run window so the newest rows weren't reached this run.
      // Surface it (never silent) but do NOT treat it as a failure — and
      // never as `unsignedScrubCount`, which is only non-zero on deployments
      // with no signing key, where it is the expected legacy state.
      if (result.truncated) {
        console.warn(
          `[AuditIntegrity] org ${organizationId}: chain exceeds the ${MAX_ENTRIES_PER_ORG}-row window; verified the oldest ${result.verifiedCount}`,
        );
      }

      // The only genuine alert condition: the chain (or a checkpoint) failed
      // to verify. `verifyAuditChain` returns `valid: false` for both a hash
      // break (`firstBrokenAt`) and a checkpoint mismatch.
      if (result.valid) continue;

      failures++;
      const reason =
        result.checkpointMismatch?.reason ??
        (result.firstBrokenAt
          ? `hash chain broken at log ${result.firstBrokenAt.logId}`
          : 'audit log chain failed verification');
      // Operator-facing log line — surfaces in log-based alerting.
      console.error(
        `[AuditIntegrity] FAILED for org ${organizationId}: ${reason}`,
        result.firstBrokenAt ?? result.checkpointMismatch ?? {},
      );

      // In-band signal: a security-category audit row. It is itself a fresh,
      // correctly-chained entry, so it does not interfere with detection of
      // the existing break it reports.
      const metadata: Record<string, unknown> = {
        verifiedCount: result.verifiedCount,
        checkpointsVerified: result.checkpointsVerified,
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
          action: 'audit_log.integrity_check_failed',
          category: 'security',
          resourceType: 'audit_log',
          status: 'failure',
          errorMessage: reason,
          metadata,
        },
      );

      // Out-of-band alert (admins' notification bell + Slack). Isolated so a
      // notification write failing for one org never aborts the sweep — the
      // in-band audit row above is already persisted as the durable record.
      try {
        await ctx.runMutation(
          internal.audit_logs.integrity_check.notifyIntegrityFailure,
          { organizationId, reason },
        );
      } catch (err) {
        console.error(
          `[AuditIntegrity] could not raise out-of-band alert for org ${organizationId}:`,
          err,
        );
      }
    }

    console.log(
      `[AuditIntegrity] checked ${organizationIds.length} org(s): ${failures} failing, ${errored} errored`,
    );
    return null;
  },
});
