import { v } from 'convex/values';

import { stripModelRefQualifier } from '../../lib/shared/utils/model-ref';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
  checkBudget,
  computeRollingRemainingCostCents,
} from './budget_enforcement';
import {
  checkModelAccess,
  getAccessibleModels,
} from './model_access_enforcement';
import { readGuardrailsPolicies } from './read_guardrails_policies';
import { resolveBudgetContext } from './resolve_budget_context';
import { resolveDefaultModel } from './resolve_default_model';
import { shouldDeferProjectSharedExpiry } from './retention_project_shared';

export const getPiiConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('domain', 'governance')
          .eq('key', 'pii_config'),
      )
      .first();
  },
});

/**
 * Batched fetch for all three guardrails policies in one round-trip.
 *
 * `sanitize.ts` callers snapshot this once per input message (or once at
 * stream start for output filtering) and pass the frozen result through
 * all subsequent filter dispatches. Mid-stream admin edits take effect on
 * the next message — never mid-response — so users never see inconsistent
 * enforcement within a single turn.
 */
/**
 * Generic policy-config reader for actions that cannot import query helpers
 * directly (e.g. node actions). Returns the raw config record or null;
 * callers validate with the policy's zod schema.
 */
export const getPolicyConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
    policyType: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('domain', 'governance')
          .eq('key', args.policyType),
      )
      .first();
    return row?.config ?? null;
  },
});

export const getGuardrailsConfigsInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    chatFilter: v.any(),
    pii: v.any(),
    moderation: v.any(),
  }),
  handler: async (ctx, args) => {
    const [chatFilter, pii, moderation] = await readGuardrailsPolicies(
      ctx,
      args.organizationId,
    );
    return { chatFilter, pii, moderation };
  },
});

export const getSystemPromptPolicyInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('domain', 'governance')
          .eq('key', 'system_prompt'),
      )
      .first();
  },
});

/**
 * Budget check wrapper for action callers (workflow LLM nodes, openai-compat
 * endpoint). Actions can't directly invoke helper functions that call ctx.db,
 * so they invoke this internal query via ctx.runQuery.
 */
export const checkBudgetForRequest = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    // Better Auth `apikey._id` of the credential that authenticated the request
    // (openai-compat path). When set, per-API-key budget rules matching this id
    // are enforced against the key's own usage. Undefined for in-app callers.
    apiKeyId: v.optional(v.string()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    code: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const { userTeamIds, userRole } = await resolveBudgetContext(
      ctx,
      args.organizationId,
      args.userId,
    );
    const result = await checkBudget(
      ctx,
      args.organizationId,
      args.userId,
      userTeamIds,
      userRole,
      0,
      0,
      args.apiKeyId,
    );
    return {
      allowed: result.allowed,
      reason: result.reason,
      code: result.code,
    };
  },
});

/**
 * Budget evaluation for an external-agent turn (action caller). Folds two
 * decisions into one round-trip:
 *  - `allowed`/`reason`: the rolling-cap verdict WITH `prospectiveCostCents`
 *    (the turn's in-task VK spend so far) added, so a long task's own spend
 *    counts toward the cap at each continuation seam — not just retrospective
 *    ledger rows. Over budget → the caller pauses the turn cleanly at the seam.
 *  - `rollingRemainingCents`: the tightest remaining cost headroom, for sizing
 *    the per-turn gateway VK so the gateway's hard cap == the rolling cap
 *    (null = uncapped → caller uses its flat default).
 */
export const evaluateExternalAgentBudget = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    prospectiveCostCents: v.optional(v.number()),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
    rollingRemainingCents: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { userTeamIds, userRole } = await resolveBudgetContext(
      ctx,
      args.organizationId,
      args.userId,
    );
    const check = await checkBudget(
      ctx,
      args.organizationId,
      args.userId,
      userTeamIds,
      userRole,
      args.prospectiveCostCents ?? 0,
    );
    const rollingRemainingCents = await computeRollingRemainingCostCents(
      ctx,
      args.organizationId,
      args.userId,
      userTeamIds,
      userRole,
    );
    return {
      allowed: check.allowed,
      ...(check.reason !== undefined && { reason: check.reason }),
      rollingRemainingCents,
    };
  },
});

/**
 * Returns every org's retention_policy row. Used by the multi-org
 * dispatcher (`runRetentionCleanup`, `effectReleasesOnly`) to enumerate
 * orgs that have retention configured. Ranges the `configCache`
 * `by_domain_key` index on `(domain='governance', key='retention_policy')`
 * so it reads exactly the retention rows (one per org) rather than scanning
 * the whole cache — strictly bounded by the org count.
 *
 * For per-org reads, use `getRetentionPolicyForOrg` instead — that path
 * is hit on every page-load + cleanup invocation and MUST go through
 * the `by_org_domain_key` index. Round-2 review CRITICAL #15 / D.8.j.
 */
export const listRetentionPolicies = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const policies = [];
    for await (const policy of ctx.db
      .query('configCache')
      .withIndex('by_domain_key', (q) =>
        q.eq('domain', 'governance').eq('key', 'retention_policy'),
      )) {
      policies.push(policy);
    }
    return policies;
  },
});

/**
 * Per-org retention policy lookup via the `by_org_domain_key` index.
 * Hot-path query: called by `runOrgRetentionCleanup` per org per run
 * and by the bounds-proposal banner on every governance page load.
 */
export const getRetentionPolicyForOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('configCache')
      .withIndex('by_org_domain_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('domain', 'governance')
          .eq('key', 'retention_policy'),
      )
      .first();
  },
});

/**
 * Per-org applied bounds row. Returns `null` when not yet seeded
 * (pre-migration / first-enable not yet run). Cleanup treats `null` as
 * "skip this org" — operator must seed first via the migration or by
 * having an admin save retention policy in the editor.
 */
export const getAppliedBounds = internalQuery({
  args: { organizationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('retentionAppliedBounds')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
  },
});

export const listExpiredTempFiles = internalQuery({
  args: {
    organizationId: v.string(),
    source: v.union(v.literal('user'), v.literal('agent')),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = [];
    for await (const file of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_source_and_documentId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('source', args.source)
          .eq('documentId', undefined),
      )) {
      const status = file.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      if (file._creationTime < args.cutoffMs) {
        files.push(file);
        if (files.length >= args.batchSize) {
          break;
        }
      }
    }
    return files;
  },
});

export const listGraceExpiredTempFiles = internalQuery({
  args: {
    organizationId: v.string(),
    source: v.union(v.literal('user'), v.literal('agent')),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const files = [];
    for await (const file of ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (file.source !== args.source) continue;
      if (file.documentId !== undefined) continue;
      const status = file.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = file.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      files.push(file);
      if (files.length >= args.batchSize) break;
    }
    return files;
  },
});

export const listExpiredDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const docs = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      // Skip already-flipped rows so Pass A doesn't keep re-stamping
      // statusChangedAt. Treat missing field as 'active' (legacy rows).
      const status = doc.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      if (doc._creationTime >= args.cutoffMs) continue;

      docs.push(doc);
      if (docs.length >= args.batchSize) {
        break;
      }
    }
    return docs;
  },
});

export const listGraceExpiredDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const docs = [];
    for await (const doc of ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = doc.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      // Mirror the threadMetadata legacy fallback: missing
      // statusChangedAt keeps the row in the grace window indefinitely
      // until a real trash/restore stamp lands.
      const ts = doc.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      docs.push(doc);
      if (docs.length >= args.batchSize) break;
    }
    return docs;
  },
});

/**
 * Threads eligible for Pass-A retention sweep: status === 'active' AND
 * the thread hasn't been touched since `cutoffMs`. With deletionGraceDays
 * === 0 the cleanup runner cascades these directly; with graceDays > 0
 * it flips them to status='expired' so they enter the admin-Trash window
 * before `listGraceExpiredThreads` picks them up later.
 *
 * Treats rows with no `status` field (legacy data pre-trash) as 'active'.
 */
export const listExpiredThreads = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const threads = [];
    for await (const thread of ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      // Skip rows that are NOT active. Trashed/expired/archived/deleted
      // rows have their own lifecycle (Pass B for trashed/expired,
      // user-controlled for archived) and must not be cascaded by the
      // active-aging path.
      const status = thread.status ?? 'active';
      if (status !== 'active') continue;

      const ts = thread.updatedAt ?? thread.createdAt;
      if (ts >= args.cutoffMs) continue;

      threads.push(thread);
      if (threads.length >= args.batchSize) {
        break;
      }
    }
    return threads;
  },
});

/**
 * Pass-B retention sweep: threads that are 'trashed' or 'expired' AND
 * whose statusChangedAt is older than `graceCutoffMs`. The cleanup
 * runner cascades these (via deleteExpiredThread → cascadeDeleteThreadChildren).
 *
 * Rows whose `statusChangedAt` is missing fall back to `_creationTime`
 * — that's the conservative bound, treating them as already-eligible
 * once they passed normal retention.
 */
export const listGraceExpiredThreads = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const threads = [];
    for await (const thread of ctx.db
      .query('threadMetadata')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = thread.status ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      // Legacy rows trashed before `statusChangedAt` was added must NOT
      // hard-delete on the first sweep that observes them. Falling back
      // to `_creationTime` would treat a row trashed yesterday but
      // created last year as already aged out. Falling back to `now()`
      // keeps legacy rows in the grace window indefinitely (the next
      // explicit trash-or-restore stamps a real timestamp). Safer than
      // a one-shot backfill (round-2 v15 H8 part 2).
      const ts = thread.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;

      // Projects feature: defer hard-delete of shared-with-project
      // threads while the project is still active. See
      // `retention_project_shared.ts` for the pure helper + tests.
      if (thread.sharedWithProject === true && thread.projectId) {
        const project = await ctx.db.get(thread.projectId);
        const defer = shouldDeferProjectSharedExpiry(
          {
            threadSharedWithProject: thread.sharedWithProject,
            projectExists: project !== null,
            projectArchivedAt: project?.archivedAt ?? null,
          },
          args.graceCutoffMs,
        );
        if (defer) continue;
      }

      threads.push(thread);
      if (threads.length >= args.batchSize) {
        break;
      }
    }
    return threads;
  },
});

/**
 * Chat-v2 threads (the `threads` table) eligible for the Pass-A retention
 * sweep: live (no `lifecycleStatus` — the absent-means-live convention) and
 * untouched since `cutoffMs`. Archived threads age out like everything else —
 * archiving is a shelf, not an exemption from retention.
 */
export const listExpiredChatThreads = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const threads = [];
    for await (const thread of ctx.db
      .query('threads')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (thread.lifecycleStatus !== undefined) continue;
      if (thread.updatedAt >= args.cutoffMs) continue;
      threads.push(thread);
      if (threads.length >= args.batchSize) break;
    }
    return threads;
  },
});

/**
 * Chat-v2 Pass-B sweep: `trashed` or `expired` threads whose grace window has
 * elapsed. `statusChangedAt` is always stamped by the trash flows, but a
 * missing one falls back to `now` — the row stays in the grace window until
 * an explicit transition stamps a real timestamp (same safety rationale as
 * the legacy twin above). Project-shared threads defer their hard-delete
 * while the project is still active, exactly like the legacy walk.
 */
export const listGraceExpiredChatThreads = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const threads = [];
    for (const status of ['trashed', 'expired'] as const) {
      for await (const thread of ctx.db
        .query('threads')
        .withIndex('by_org_lifecycle', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('lifecycleStatus', status),
        )) {
        const ts = thread.statusChangedAt ?? Date.now();
        if (ts >= args.graceCutoffMs) continue;

        if (thread.sharedWithProject === true && thread.projectId) {
          const project = await ctx.db.get(thread.projectId);
          const defer = shouldDeferProjectSharedExpiry(
            {
              threadSharedWithProject: thread.sharedWithProject,
              projectExists: project !== null,
              projectArchivedAt: project?.archivedAt ?? null,
            },
            args.graceCutoffMs,
          );
          if (defer) continue;
        }

        threads.push(thread);
        if (threads.length >= args.batchSize) break;
      }
      if (threads.length >= args.batchSize) break;
    }
    return threads;
  },
});

export const listExpiredWorkflowExecutions = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const executions = [];
    for await (const execution of ctx.db
      .query('wfExecutions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = execution.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      if (execution.startedAt >= args.cutoffMs) continue;

      executions.push(execution);
      if (executions.length >= args.batchSize) {
        break;
      }
    }
    return executions;
  },
});

export const listGraceExpiredWorkflowExecutions = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const execution of ctx.db
      .query('wfExecutions')
      .withIndex('by_org_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = execution.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = execution.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(execution);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

/**
 * Look up the active pending-shortening row for an org's retention
 * policy. Returns `null` when no pending row exists OR the pending row's
 * `appliesAt` has elapsed (in which case the cooldown is over and the
 * caller should sweep the row + use the new config).
 */
export const getPendingRetentionChange = internalQuery({
  args: { organizationId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id('retentionPolicyPendingChanges'),
      appliesAt: v.number(),
      oldConfig: v.any(),
      newConfig: v.any(),
      summary: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('retentionPolicyPendingChanges')
      .withIndex('by_organizationId_appliesAt', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .order('desc')
      .first();
    if (!row) return null;
    return {
      _id: row._id,
      appliesAt: row.appliesAt,
      oldConfig: row.oldConfig,
      newConfig: row.newConfig,
      summary: row.summary,
    };
  },
});

/**
 * Fetch a specific pending retention-change row's `oldConfig` by id, scoped to
 * the org. Used by `cancelPendingRetentionChange` (V8 action) to know which
 * config to revert the file to before deleting the pending row.
 */
export const getRetentionPendingById = internalQuery({
  args: {
    organizationId: v.string(),
    pendingId: v.id('retentionPolicyPendingChanges'),
  },
  returns: v.union(v.object({ oldConfig: v.any() }), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.pendingId);
    if (!row || row.organizationId !== args.organizationId) return null;
    return { oldConfig: row.oldConfig };
  },
});

export const listExpiredMessageFeedback = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('messageFeedback')
      .withIndex('by_org_createdAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('createdAt', args.cutoffMs),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listGraceExpiredMessageFeedback = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('messageFeedback')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = row.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

/**
 * Phase 11 — twoFactorAttempts parity sweep. The table is keyed by
 * userId only (no organizationId, no createdAt — uses _creationTime).
 * A "stuck" row is one where the last activity (`lastFailureAt`) was
 * more than `cutoffMs` ago AND the user is no longer locked.
 */
export const listExpiredTwoFactorAttempts = internalQuery({
  args: { cutoffMs: v.number(), batchSize: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('twoFactorAttempts')
      .withIndex('by_lastFailureAt', (q) =>
        q.lt('lastFailureAt', args.cutoffMs),
      )) {
      // Skip rows still in active lockout — clearing them would let
      // an attacker bypass the lockout window.
      if (row.lockedUntil !== null && row.lockedUntil > Date.now()) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listExpiredContacts = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('contacts')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      if (row._creationTime >= args.cutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listGraceExpiredContacts = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('contacts')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = row.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listExpiredExternalConversations = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    // `lastMessageAt` is optional; rows that never received a message
    // won't match the index range and are intentionally not eligible
    // for retention deletion (no activity timestamp to age against).
    for await (const row of ctx.db
      .query('conversations')
      .withIndex('by_org_lastMessageAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('lastMessageAt', args.cutoffMs),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listGraceExpiredExternalConversations = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = row.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

/**
 * Round-2 V6 P0-17 — list notifications past the org's retention
 * cutoff. Walks the `by_org_created` index range, no per-row hold
 * cascade (notifications are admin telemetry, not user-attributed
 * artifacts; org-wide hold is the only gate).
 */
export const listExpiredNotifications = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('notifications')
      .withIndex('by_org_created', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('createdAt', args.cutoffMs),
      )) {
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listExpiredChatFilterEvents = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('chatFilterEvents')
      .withIndex('by_org_createdAt', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('createdAt', args.cutoffMs),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listGraceExpiredChatFilterEvents = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('chatFilterEvents')
      .withIndex('by_org_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = row.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listExpiredUsageLedgerRows = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('usageLedger')
      .withIndex('by_org_period', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'active') continue;
      if (row._creationTime >= args.cutoffMs) continue;

      rows.push(row);
      if (rows.length >= args.batchSize) {
        break;
      }
    }
    return rows;
  },
});

export const listGraceExpiredUsageLedgerRows = internalQuery({
  args: {
    organizationId: v.string(),
    graceCutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('usageLedger')
      .withIndex('by_org_lifecycleStatus', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      const status = row.lifecycleStatus ?? 'active';
      if (status !== 'trashed' && status !== 'expired') continue;
      const ts = row.statusChangedAt ?? Date.now();
      if (ts >= args.graceCutoffMs) continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});

export const listExpiredLoginAttempts = internalQuery({
  args: {
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const attempts = [];
    for await (const attempt of ctx.db
      .query('loginAttempts')
      .withIndex('by_lastFailureAt', (q) =>
        q.lt('lastFailureAt', args.cutoffMs),
      )) {
      attempts.push(attempt);
      if (attempts.length >= args.batchSize) {
        break;
      }
    }
    return attempts;
  },
});

export const listExpiredLoginBlockCounters = internalQuery({
  args: {
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const counters = [];
    for await (const counter of ctx.db
      .query('loginBlockCounters')
      .withIndex('by_window')) {
      if (counter.windowStart >= args.cutoffMs) break;

      counters.push(counter);
      if (counters.length >= args.batchSize) {
        break;
      }
    }
    return counters;
  },
});

export const checkModelAccessInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    modelId: v.string(),
  },
  returns: v.object({
    allowed: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
    });
    const teamIds = await getUserTeamIds(ctx, args.userId);

    return checkModelAccess(
      ctx,
      args.organizationId,
      args.userId,
      teamIds,
      member.role,
      args.modelId,
    );
  },
});

/**
 * Single-round-trip governance resolution for a chat generation turn.
 *
 * Folds the per-turn governance reads — default-model override, implicit
 * accessible-model filter, and explicit model-access check — into ONE query so
 * the node generation action makes a single backend round-trip. It fetches the
 * org member + team IDs ONCE and threads them into every business function
 * (which already take `ctx`), so membership is read once per turn rather than
 * once per governance check.
 *
 * `explicitModelId` set → caller pinned a model: returns `explicitAccess` only.
 * `explicitModelId` unset → implicit path: returns `defaultModel` (governance
 * override, already access-filtered) + `accessibleModelIds` (the subset of
 * `supportedModels` the user may use). `supportedModels` are plain (qualifier-
 * stripped) ids; the action maps the returned subset back to qualified refs.
 */
export const resolveGenerationGovernance = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.optional(v.string()),
    supportedModels: v.array(v.string()),
    explicitModelId: v.optional(v.string()),
  },
  returns: v.object({
    defaultModel: v.union(
      v.object({ providerName: v.string(), modelId: v.string() }),
      v.null(),
    ),
    accessibleModelIds: v.array(v.string()),
    explicitAccess: v.union(
      v.object({ allowed: v.boolean(), reason: v.optional(v.string()) }),
      v.null(),
    ),
    // The org member + team context this query already fetched. Returned so the
    // downstream budget/feature-flag enforcement (in startChat) can reuse it
    // instead of re-fetching member (betterAuth findMany) + teamIds — each a
    // ~40-60ms cross-component sub-transaction. `getOrganizationMember` here
    // also throws on non-membership, so the caller can treat a successful
    // governance resolution as having verified org membership.
    role: v.string(),
    teamIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });
    const teamIds = await getUserTeamIds(ctx, args.userId);

    if (args.explicitModelId) {
      const explicitAccess = await checkModelAccess(
        ctx,
        args.organizationId,
        args.userId,
        teamIds,
        member.role,
        args.explicitModelId,
      );
      return {
        defaultModel: null,
        accessibleModelIds: [],
        explicitAccess,
        role: member.role,
        teamIds,
      };
    }

    const [defaultModel, accessibleModelIds] = await Promise.all([
      resolveDefaultModel(
        ctx,
        args.organizationId,
        args.userId,
        teamIds,
        member.role,
      ),
      getAccessibleModels(
        ctx,
        args.organizationId,
        args.userId,
        teamIds,
        member.role,
        args.supportedModels,
      ),
    ]);
    return {
      defaultModel,
      accessibleModelIds,
      explicitAccess: null,
      role: member.role,
      teamIds,
    };
  },
});

/**
 * Batched per-turn model-governance resolver.
 *
 * `chatWithAgent` previously fired up to THREE separate internalQueries per
 * chat turn — `resolveDefaultModelInternal`, `getAccessibleModelsInternal`,
 * and `checkModelAccessInternal` — each of which independently re-resolved the
 * SAME org-member + team context. Those lookups make cross-component
 * Better-Auth `findMany` calls (the dominant backend cost), so re-resolving
 * them per query multiplied the latency.
 *
 * This query resolves the member + team context ONCE and runs every governance
 * decision the chat turn needs against that single context:
 *
 * - `defaultModel`: governance default-model override (no-model path). Mirrors
 *   `resolveDefaultModelInternal` — null when no override applies OR the
 *   override is denied by the model_access policy.
 * - `accessibleModelRefs`: `supportedModels` filtered by the model_access
 *   policy (no-model path). Mirrors `getAccessibleModelsInternal` — the input
 *   list passed through `getAccessibleModels` with plain (qualifier-stripped)
 *   ids, but the RETURNED refs are the ORIGINAL (possibly qualified)
 *   `supportedModels` entries whose plain id survived the filter, so the
 *   caller keeps provider qualifiers.
 * - `explicitAllowed`: RBAC decision for an explicitly-requested model
 *   (explicit-modelId path). Mirrors `checkModelAccessInternal`. Only computed
 *   when `explicitModelId` is provided.
 *
 * Behavior is identical to the three originals; the only change is that the
 * member/team lookup happens once instead of two-or-three times. The three
 * originals are retained because they have other callers (openai-compat +
 * workflow LLM nodes).
 */
export const resolveModelGovernanceInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    userName: v.optional(v.string()),
    supportedModels: v.array(v.string()),
    explicitModelId: v.optional(v.string()),
  },
  returns: v.object({
    defaultModel: v.optional(
      v.object({
        providerName: v.string(),
        modelId: v.string(),
      }),
    ),
    accessibleModelRefs: v.array(v.string()),
    explicitAllowed: v.optional(
      v.object({
        allowed: v.boolean(),
        reason: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    // Resolve the member + team context ONCE. `getOrganizationMember` accepts
    // the optional email/name (used by the default-model path's email-fallback
    // lookup); passing them through is a superset of the userId-only resolution
    // the access-policy paths used, so it yields the same member row.
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      ...(args.userEmail !== undefined ? { email: args.userEmail } : {}),
      ...(args.userName !== undefined ? { name: args.userName } : {}),
    });
    // `getUserTeamIds` is the authoritative team resolver (trusted-headers JWT
    // claims first, then full paginated teamMember scan) — the same one the
    // access-policy queries used. Reusing it keeps the model_access filtering
    // (the security-critical allowlist) identical.
    const teamIds = await getUserTeamIds(ctx, args.userId);

    const explicitAllowed =
      args.explicitModelId !== undefined
        ? await checkModelAccess(
            ctx,
            args.organizationId,
            args.userId,
            teamIds,
            member.role,
            args.explicitModelId,
          )
        : undefined;

    // The explicit-modelId path never consults the governance default or the
    // accessible-fallback list (the caller short-circuits to the RBAC check),
    // so skip those lookups when an explicit model was requested — preserving
    // the original per-path query semantics while avoiding wasted policy reads.
    if (args.explicitModelId !== undefined) {
      return {
        defaultModel: undefined,
        accessibleModelRefs: [],
        explicitAllowed,
      };
    }

    const defaultModel = await resolveDefaultModel(
      ctx,
      args.organizationId,
      args.userId,
      teamIds,
      member.role,
    );

    const accessiblePlain = await getAccessibleModels(
      ctx,
      args.organizationId,
      args.userId,
      teamIds,
      member.role,
      args.supportedModels.map(stripModelRefQualifier),
    );
    const accessibleSet = new Set(accessiblePlain);
    const accessibleModelRefs = args.supportedModels.filter((ref) =>
      accessibleSet.has(stripModelRefQualifier(ref)),
    );

    return {
      defaultModel: defaultModel ?? undefined,
      accessibleModelRefs,
      explicitAllowed: undefined,
    };
  },
});

/**
 * Auth helper for V8 actions in governance/retention_actions.ts.
 * Confirms the caller is a member of the org. Throws on missing
 * membership. Returns the member row so the caller can inspect role.
 */
export const verifyOrgMember = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.object({ role: v.string() }),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
    return { role: member.role };
  },
});

/**
 * Auth helper for admin-only V8 actions. Returns null when the caller
 * is a member but not an admin (caller throws an admin-required error).
 */
export const verifyOrgAdmin = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.object({ role: v.string() })),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
    if (!isAdmin(member.role)) return null;
    return { role: member.role };
  },
});

/** Terminal `taskAgentRuns` rows older than the cutoff (retention sweep). */
export const listExpiredTaskAgentRuns = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = [];
    for await (const row of ctx.db
      .query('taskAgentRuns')
      .withIndex('by_org_started', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .lt('startedAt', args.cutoffMs),
      )) {
      // Never delete a live run, however old — the stuck-run sweep owns
      // flipping dead 'running' rows to terminal first.
      if (row.status === 'running') continue;
      rows.push(row);
      if (rows.length >= args.batchSize) break;
    }
    return rows;
  },
});
