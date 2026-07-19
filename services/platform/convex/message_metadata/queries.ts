import { type Infer, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { messageMetadataValidator } from '../streaming/validators';
import {
  type ChatHealthStats,
  computeChatHealthStats,
} from './chat_health_stats';

export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.union(messageMetadataValidator, v.null()),
  handler: async (ctx, args) => {
    const direct = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();
    if (direct) return direct;

    // In error scenarios, the metadata is saved with the failed message's
    // ID which differs from the UIMessage id (first message in group).
    // Fall back to the most recent metadata entry for this thread.
    const { threadId } = args;
    if (threadId) {
      return ctx.db
        .query('messageMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .order('desc')
        .first();
    }

    return null;
  },
});

/**
 * Batched companion to {@link getMessageMetadata}: returns EVERY metadata row
 * for a thread in one subscription via the `by_threadId` index. The per-bubble
 * `useMessageMetadata` hook reads from this shared map when a thread-level
 * subscription is mounted, collapsing N per-message subscriptions (one per
 * assistant bubble) into a single thread subscription. Each row is the same
 * shape `getMessageMetadata` returns (the existing `messageMetadataValidator`),
 * so consumers project identically — no output-shape change.
 *
 * Access is unchanged: this reads the same table the per-message query reads.
 * Authorization is enforced upstream by the thread's own read gate (the thread
 * messages query); metadata rows carry no independent ACL beyond `threadId`.
 */
export const getThreadMessageMetadata = query({
  args: {
    threadId: v.string(),
  },
  returns: v.array(messageMetadataValidator),
  handler: async (ctx, args) => {
    const rows: Infer<typeof messageMetadataValidator>[] = [];
    for await (const row of ctx.db
      .query('messageMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      rows.push(row);
    }
    return rows;
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Byte budget for the read-time chat-health scan. A Convex query transaction
 * caps at ~8 MiB of reads and THROWS past it; `messageMetadata` rows are heavy
 * (`contextWindow` up to 500K chars, plus `reasoning` and tool I/O), so the
 * scan bounds cumulative bytes well under that ceiling and stops early rather
 * than risk the transaction failing. A capped scan still covers the most-recent
 * turns — the relevant sample for "is chat slow lately" — surfaced via the
 * `capped` flag. The scalable successor (on-write / cron latency-histogram
 * buckets, which make percentiles additive) is a later observability
 * instrument, not this pilot.
 */
const SCAN_BYTE_BUDGET = 2 * 1024 * 1024;
/**
 * Secondary cap: never scan more than this many rows even when they are tiny.
 * Kept well under Convex's 16,384-document per-transaction ceiling.
 */
const MAX_SCAN_ROWS = 5_000;

/** Rolling-window inclusive lower bound (ms) for a selectable period. */
function windowStartMs(periodDays: 1 | 7 | 30, now: number): number {
  return now - periodDays * DAY_MS;
}

/**
 * Approximate serialized size of a metadata row, dominated by its heavy string
 * fields. Used only to bound the scan — precision beyond "which fields are
 * large" is unnecessary.
 */
function approxRowBytes(row: Doc<'messageMetadata'>): number {
  let bytes = 512; // scalar/base field overhead
  bytes += row.contextWindow?.length ?? 0;
  bytes += row.reasoning?.length ?? 0;
  for (const tool of row.toolsUsage ?? []) {
    bytes += (tool.input?.length ?? 0) + (tool.output?.length ?? 0);
  }
  return bytes;
}

export interface ChatHealthRollupResult extends ChatHealthStats {
  /** Distinguishes "org has never chatted" from "quiet window". */
  hasAnyData: boolean;
}

/**
 * Per-organization chat-health rollup for the admin Metrics → Chat health panel
 * (observability instrument #1). Admin-only and org-scoped: aggregates the org's
 * own `messageMetadata` telemetry over a rolling window into error-rate, latency
 * p50/p95, tool-call volume, routing distribution, and token + cost totals.
 *
 * Tenant isolation is enforced AT THE INDEX — the scan keys on `organizationId`
 * by equality, so one org's rollup can never read another org's rows (rows with
 * no org sort under `undefined` and are never returned). Mirrors
 * `feedback/queries.ts:getFeedbackStats`: a manual admin gate via the shared RLS
 * helpers on the plain `query` wrapper (this table is not in `rls_rules`, so
 * `queryWithRLS` — which defaults to deny — is not used).
 */
export const getChatHealthRollup = query({
  args: {
    organizationId: v.string(),
    periodDays: v.optional(v.union(v.literal(1), v.literal(7), v.literal(30))),
  },
  handler: async (ctx, args): Promise<ChatHealthRollupResult | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (!isAdmin(member.role)) {
      throw new Error('Only admins can view chat health metrics');
    }

    const now = Date.now();
    const cutoffMs = windowStartMs(args.periodDays ?? 7, now);

    // Existence probe (mirrors getFeedbackStats' hasAnyFeedback): one indexed
    // read distinguishing "never chatted" from "quiet window".
    const probe = await ctx.db
      .query('messageMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    const hasAnyData = probe !== null;

    // Byte-bounded, newest-first scan over the org's window. Bounding by BYTES
    // (not just row count) is what keeps the heavy `contextWindow` field from
    // blowing the transaction's read limit.
    const rows: Doc<'messageMetadata'>[] = [];
    let scannedBytes = 0;
    let byteCapped = false;
    for await (const row of ctx.db
      .query('messageMetadata')
      .withIndex('by_organizationId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('_creationTime', cutoffMs),
      )
      .order('desc')) {
      rows.push(row);
      scannedBytes += approxRowBytes(row);
      if (scannedBytes >= SCAN_BYTE_BUDGET || rows.length >= MAX_SCAN_ROWS) {
        byteCapped = true;
        break;
      }
    }

    const stats = computeChatHealthStats(rows, {
      windowStartMs: cutoffMs,
      maxScan: MAX_SCAN_ROWS,
    });

    return { ...stats, capped: stats.capped || byteCapped, hasAnyData };
  },
});
