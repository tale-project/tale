import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { checkBudget } from './budget_enforcement';
import {
  checkModelAccess,
  getAccessibleModels,
} from './model_access_enforcement';
import { resolveBudgetContext } from './resolve_budget_context';
import { resolveDefaultModel } from './resolve_default_model';

export const getPiiConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'pii_config'),
      )
      .first();
  },
});

export const getSystemPromptPolicyInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'system_prompt'),
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
    );
    return {
      allowed: result.allowed,
      reason: result.reason,
      code: result.code,
    };
  },
});

export const listRetentionPolicies = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const policies = [];
    for await (const policy of ctx.db.query('governancePolicies')) {
      if (policy.policyType === 'retention_policy') {
        policies.push(policy);
      }
    }
    return policies;
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
      if (doc._creationTime >= args.cutoffMs) continue;

      docs.push(doc);
      if (docs.length >= args.batchSize) {
        break;
      }
    }
    return docs;
  },
});

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
      if (execution.startedAt >= args.cutoffMs) continue;

      executions.push(execution);
      if (executions.length >= args.batchSize) {
        break;
      }
    }
    return executions;
  },
});

export const listExpiredWorkflowTriggerLogs = internalQuery({
  args: {
    organizationId: v.string(),
    cutoffMs: v.number(),
    batchSize: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const logs = [];
    for await (const log of ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (log.receivedAt >= args.cutoffMs) continue;

      logs.push(log);
      if (logs.length >= args.batchSize) {
        break;
      }
    }
    return logs;
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
      if (row._creationTime >= args.cutoffMs) continue;

      rows.push(row);
      if (rows.length >= args.batchSize) {
        break;
      }
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
    for await (const attempt of ctx.db.query('loginAttempts')) {
      if (attempt.lastFailureAt >= args.cutoffMs) continue;

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

interface BetterAuthTeamMember {
  teamId: string;
}

interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor: string;
  isDone: boolean;
}

export const resolveDefaultModelInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.string(),
    userName: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      providerName: v.string(),
      modelId: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
      email: args.userEmail,
      name: args.userName,
    });

    const membershipsResult: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1000 },
        where: [{ field: 'userId', operator: 'eq', value: member.userId }],
      });

    const teamIds = membershipsResult?.page.map((m) => m.teamId) ?? [];

    return resolveDefaultModel(ctx, args.organizationId, teamIds, member.role);
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

export const getAccessibleModelsInternal = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    modelIds: v.array(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
    });
    const teamIds = await getUserTeamIds(ctx, args.userId);

    return getAccessibleModels(
      ctx,
      args.organizationId,
      args.userId,
      teamIds,
      member.role,
      args.modelIds,
    );
  },
});
