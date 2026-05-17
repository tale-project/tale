import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { buildPeriodKeyFromTimestamp } from './helpers';

/**
 * Resolve the post-insert duplicate-row race for usage-ledger writers.
 *
 * Two mutations that both see `existing === null` and insert will leave
 * two rows with the same `(organizationId, userId, periodKey, teamId,
 * agentSlug, model)` key. Without this guard, period aggregates silently
 * fork — reports double-count, budget gates under-trip — until manual
 * reconciliation. Call this immediately AFTER an insert; it scans the
 * upsert-key index, keeps the oldest row, sums every other duplicate's
 * counters into it, and deletes the rest.
 *
 * `extraKeys` enumerates the non-token columns each writer accumulates
 * (e.g. `characterCount` for TTS, `audioDurationSec` for transcription,
 * `integrationCallCount` for integrations). The helper iterates them so
 * each writer doesn't have to hand-roll the same merge logic, and so the
 * `feedback_minimal_scope` invariant holds — there is one canonical
 * dedup path, not three near-duplicates.
 */
export async function mergeDuplicateLedgerRows(
  ctx: MutationCtx,
  key: {
    organizationId: string;
    userId: string;
    periodKey: string;
    teamId: string | undefined;
    agentSlug: string | undefined;
    model: string | undefined;
  },
  extraKeys: ReadonlyArray<
    'characterCount' | 'audioDurationSec' | 'integrationCallCount'
  > = [],
): Promise<void> {
  const dupQuery = ctx.db
    .query('usageLedger')
    .withIndex('by_org_user_period_team_agent_model', (q) =>
      q
        .eq('organizationId', key.organizationId)
        .eq('userId', key.userId)
        .eq('periodKey', key.periodKey)
        .eq('teamId', key.teamId)
        .eq('agentSlug', key.agentSlug)
        .eq('model', key.model),
    );
  const allEntries = [];
  for await (const entry of dupQuery) {
    allEntries.push(entry);
  }
  if (allEntries.length <= 1) return;

  const sorted = allEntries.sort((a, b) => a._creationTime - b._creationTime);
  const keep = sorted[0];
  if (!keep) return;

  let sumInput = 0;
  let sumOutput = 0;
  let sumTotal = 0;
  let sumCost = 0;
  let sumRequests = 0;
  const extraSums: Record<string, number> = {};
  for (const k of extraKeys) extraSums[k] = 0;
  for (const entry of sorted) {
    sumInput += entry.inputTokens;
    sumOutput += entry.outputTokens;
    sumTotal += entry.totalTokens;
    sumCost += entry.costEstimate;
    sumRequests += entry.requestCount;
    for (const k of extraKeys) {
      extraSums[k] += entry[k] ?? 0;
    }
  }

  const patch: Record<string, number> = {
    inputTokens: sumInput,
    outputTokens: sumOutput,
    totalTokens: sumTotal,
    costEstimate: sumCost,
    requestCount: sumRequests,
  };
  for (const k of extraKeys) patch[k] = extraSums[k];
  await ctx.db.patch(keep._id, patch);

  for (let i = 1; i < sorted.length; i++) {
    const dup = sorted[i];
    if (!dup) continue;
    await ctx.db.delete(dup._id);
  }
}

/**
 * Upsert a single guardrails secret row. Called from `saveModerationSecret`
 * (Node action) after the plaintext has been AES-GCM-encrypted; the V8
 * DB layer only ever sees ciphertext. `name` scopes different secret
 * kinds per org — today only `moderation_auth_header` is defined.
 */
export const upsertGuardrailsSecret = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    ciphertext: v.string(),
    nonce: v.string(),
    authTag: v.string(),
    keyFingerprint: v.string(),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('governanceSecrets')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .first();
    const patch = {
      ciphertext: args.ciphertext,
      nonce: args.nonce,
      authTag: args.authTag,
      keyFingerprint: args.keyFingerprint,
      updatedAt: Date.now(),
      updatedBy: args.updatedBy,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('governanceSecrets', {
        organizationId: args.organizationId,
        name: args.name,
        ...patch,
      });
    }
    return null;
  },
});

export const requireOrganizationMemberInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
    return null;
  },
});

export const requireGovernanceAdminInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.email,
      name: args.name,
    });
    if (!isAdmin(member.role)) {
      throw new Error(
        'Only admins can manage guardrails secrets for this organization',
      );
    }
    return null;
  },
});

export const getGuardrailsSecretInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      ciphertext: v.string(),
      nonce: v.string(),
      authTag: v.string(),
      keyFingerprint: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('governanceSecrets')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .first();
    if (!row) return null;
    return {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyFingerprint: row.keyFingerprint,
      updatedAt: row.updatedAt,
    };
  },
});

export const incrementUsageLedger = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
    // Assistant / workflow step slug. Undefined for direct model-API calls.
    agentSlug: v.optional(v.string()),
    // LLM model identifier (e.g. "gpt-4o-mini"). Part of the upsert key.
    model: v.optional(v.string()),
    // LLM provider (e.g. "openai"). Stored only; functionally determined by model.
    provider: v.optional(v.string()),
    period: v.optional(
      v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly')),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    const totalTokens = args.inputTokens + args.outputTokens;

    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);

      const existing = await ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period_team_agent_model', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey)
            .eq('teamId', args.teamId)
            .eq('agentSlug', args.agentSlug)
            .eq('model', args.model),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          inputTokens: existing.inputTokens + args.inputTokens,
          outputTokens: existing.outputTokens + args.outputTokens,
          totalTokens: existing.totalTokens + totalTokens,
          costEstimate: existing.costEstimate + args.costEstimateCents,
          requestCount: existing.requestCount + 1,
          // Provider is functionally determined by model, but patch it in case
          // the existing row was written before provider was tracked.
          ...(args.provider !== undefined && existing.provider === undefined
            ? { provider: args.provider }
            : {}),
        });
      } else {
        await ctx.db.insert('usageLedger', {
          organizationId: args.organizationId,
          userId: args.userId,
          teamId: args.teamId,
          periodKey,
          granularity: period,
          agentSlug: args.agentSlug,
          model: args.model,
          provider: args.provider,
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          totalTokens,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
        });

        await mergeDuplicateLedgerRows(ctx, {
          organizationId: args.organizationId,
          userId: args.userId,
          periodKey,
          teamId: args.teamId,
          agentSlug: args.agentSlug,
          model: args.model,
        });
      }
    }

    return null;
  },
});

/**
 * Record a single external integration call (e.g. Tavily search) in the
 * usageLedger for per-org/per-user accounting. Unlike LLM rows, integration
 * rows use `integrationName` + `integrationOperation` as the dedup key
 * (model is unset) and accumulate `integrationCallCount` + `costEstimate`.
 */
export const recordIntegrationUsage = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    // Required: callers must pass either the calling agent's slug or
    // INTEGRATION_SLUG when invoked outside an agent context. Enforces the
    // attribution invariant the analytics aggregator relies on.
    agentSlug: v.string(),
    integrationName: v.string(),
    integrationOperation: v.string(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
      const existingQuery = ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period_team', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey)
            .eq('teamId', args.teamId),
        );
      let match: Awaited<ReturnType<typeof existingQuery.first>> | null = null;
      for await (const entry of existingQuery) {
        if (
          entry.agentSlug === args.agentSlug &&
          entry.integrationName === args.integrationName &&
          entry.integrationOperation === args.integrationOperation
        ) {
          match = entry;
          break;
        }
      }

      if (match) {
        await ctx.db.patch(match._id, {
          integrationCallCount: (match.integrationCallCount ?? 0) + 1,
          costEstimate: match.costEstimate + args.costEstimateCents,
          requestCount: match.requestCount + 1,
        });
      } else {
        await ctx.db.insert('usageLedger', {
          organizationId: args.organizationId,
          userId: args.userId,
          teamId: args.teamId,
          periodKey,
          granularity: period,
          agentSlug: args.agentSlug,
          model: undefined,
          provider: undefined,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
          integrationName: args.integrationName,
          integrationOperation: args.integrationOperation,
          integrationCallCount: 1,
        });
      }
    }
    return null;
  },
});

/**
 * Record a transcription (speech-to-text) call to the usage ledger. Billed per
 * minute of audio rather than per token — `inputTokens`/`outputTokens` are left
 * at 0 and `audioDurationSec` carries the billable unit.
 */
export const recordTranscriptionUsage = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    teamId: v.optional(v.string()),
    // Required: callers must pass either the invoking agent's slug or
    // TRANSCRIPTION_SLUG when running from the file pipeline (no agent ctx).
    agentSlug: v.string(),
    model: v.string(),
    provider: v.string(),
    audioDurationSec: v.number(),
    costEstimateCents: v.number(),
    timestamp: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
    for (const period of ALL_PERIODS) {
      const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
      const existingQuery = ctx.db
        .query('usageLedger')
        .withIndex('by_org_user_period_team_agent_model', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('userId', args.userId)
            .eq('periodKey', periodKey)
            .eq('teamId', args.teamId)
            .eq('agentSlug', args.agentSlug)
            .eq('model', args.model),
        );
      const match = await existingQuery.first();

      if (match) {
        await ctx.db.patch(match._id, {
          audioDurationSec:
            (match.audioDurationSec ?? 0) + args.audioDurationSec,
          costEstimate: match.costEstimate + args.costEstimateCents,
          requestCount: match.requestCount + 1,
        });
      } else {
        await ctx.db.insert('usageLedger', {
          organizationId: args.organizationId,
          userId: args.userId,
          teamId: args.teamId,
          periodKey,
          granularity: period,
          agentSlug: args.agentSlug,
          model: args.model,
          provider: args.provider,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costEstimate: args.costEstimateCents,
          requestCount: 1,
          audioDurationSec: args.audioDurationSec,
        });

        await mergeDuplicateLedgerRows(
          ctx,
          {
            organizationId: args.organizationId,
            userId: args.userId,
            periodKey,
            teamId: args.teamId,
            agentSlug: args.agentSlug,
            model: args.model,
          },
          ['audioDurationSec'],
        );
      }
    }
    return null;
  },
});

export interface RecordTtsUsageArgs {
  organizationId: string;
  userId: string;
  teamId?: string;
  agentSlug: string;
  model: string;
  provider: string;
  characterCount: number;
  costEstimateCents: number;
  timestamp: number;
}

/**
 * Inline TTS-ledger writer. Same upsert + dedup-merge logic as
 * `recordTtsUsage` (below), but a plain function so callers in the same
 * transaction (notably `markChunkReadyAndRecordUsage`) can fold the
 * ledger write into one atomic step — critical for avoiding the
 * "audio stored but never billed" window described in the round-2 review.
 */
export async function recordTtsUsageInline(
  ctx: MutationCtx,
  args: RecordTtsUsageArgs,
): Promise<void> {
  const ALL_PERIODS = ['daily', 'weekly', 'monthly'] as const;
  for (const period of ALL_PERIODS) {
    const periodKey = buildPeriodKeyFromTimestamp(period, args.timestamp);
    // The `by_org_user_period_team_agent_model` index does NOT include
    // `provider` as a key, so an in-memory filter by provider is the
    // minimal way to keep TTS rows from being merged into a sibling LLM
    // row that happens to share `(org, user, period, team, agent,
    // model)` under a different provider. Without this guard, a TTS
    // chunk with `provider: 'openai'` could land its character count on
    // an Anthropic LLM row (same agent slug, same model string), and
    // analytics would attribute TTS spend to the LLM provider. With
    // current TTS-only-OpenAI configs this is latent; once a second
    // TTS provider ships it becomes load-bearing. A proper structural
    // fix is to extend the index to include `provider` (tracked as a
    // follow-up).
    const candidate = await ctx.db
      .query('usageLedger')
      .withIndex('by_org_user_period_team_agent_model', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('periodKey', periodKey)
          .eq('teamId', args.teamId)
          .eq('agentSlug', args.agentSlug)
          .eq('model', args.model),
      )
      .first();
    const match =
      candidate &&
      (candidate.provider === undefined || candidate.provider === args.provider)
        ? candidate
        : null;

    if (match) {
      await ctx.db.patch(match._id, {
        characterCount: (match.characterCount ?? 0) + args.characterCount,
        costEstimate: match.costEstimate + args.costEstimateCents,
        requestCount: match.requestCount + 1,
        // Mid-period provider swap: the aggregate row was written under
        // the old provider but the new write is from the new provider.
        // Patch the field only when the row had no provider set yet, so
        // the Top Models bucket attributes new usage to the actual
        // provider rather than the historical one. Mirrors the LLM
        // path's reconcile at line 265-267 above.
        ...(args.provider !== undefined && match.provider === undefined
          ? { provider: args.provider }
          : {}),
      });
    } else {
      await ctx.db.insert('usageLedger', {
        organizationId: args.organizationId,
        userId: args.userId,
        teamId: args.teamId,
        periodKey,
        granularity: period,
        agentSlug: args.agentSlug,
        model: args.model,
        provider: args.provider,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costEstimate: args.costEstimateCents,
        requestCount: 1,
        characterCount: args.characterCount,
      });

      await mergeDuplicateLedgerRows(
        ctx,
        {
          organizationId: args.organizationId,
          userId: args.userId,
          periodKey,
          teamId: args.teamId,
          agentSlug: args.agentSlug,
          model: args.model,
        },
        ['characterCount'],
      );
    }
  }
}
