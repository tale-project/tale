import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls';
import { checkBudget } from './budget_enforcement';
import { checkModelAccess } from './model_access_enforcement';
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
