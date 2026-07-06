import { v } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { internalQuery, query } from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../../lib/rls/organization/get_organization_member';

async function countTriggerActivity(
  ctx: QueryCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<{
  hasActiveTrigger: boolean;
  totalTriggers: number;
  activeTriggers: number;
}> {
  let totalTriggers = 0;
  let activeTriggers = 0;

  const tables = [
    'wfSchedules',
    'wfWebhooks',
    'wfEventSubscriptions',
    'wfApiKeys',
  ] as const;

  for (const table of tables) {
    for await (const row of ctx.db
      .query(table)
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', workflowSlug),
      )) {
      if (row.organizationId !== organizationId) continue;
      totalTriggers += 1;
      if (row.isActive) activeTriggers += 1;
    }
  }

  return {
    hasActiveTrigger: activeTriggers > 0,
    totalTriggers,
    activeTriggers,
  };
}

export const getTriggerActivityBySlugInternal = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({
    hasActiveTrigger: v.boolean(),
    totalTriggers: v.number(),
    activeTriggers: v.number(),
  }),
  handler: async (ctx, args) =>
    countTriggerActivity(ctx, args.organizationId, args.workflowSlug),
});

export const getSchedulesBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfSchedules'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfSchedules'>[] = [];
    for await (const schedule of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (schedule.organizationId === args.organizationId) {
        results.push(schedule);
      }
    }
    return results;
  },
});

export const getWebhooksBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfWebhooks'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfWebhooks'>[] = [];
    for await (const webhook of ctx.db
      .query('wfWebhooks')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (webhook.organizationId === args.organizationId) {
        results.push(webhook);
      }
    }
    return results;
  },
});

export const getEventSubscriptionsBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfEventSubscriptions'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfEventSubscriptions'>[] = [];
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sub.organizationId === args.organizationId) {
        results.push(sub);
      }
    }
    return results;
  },
});

export const getTriggerActivityBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({
    hasActiveTrigger: v.boolean(),
    totalTriggers: v.number(),
    activeTriggers: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    hasActiveTrigger: boolean;
    totalTriggers: number;
    activeTriggers: number;
  }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    return countTriggerActivity(ctx, args.organizationId, args.workflowSlug);
  },
});

export const getTriggerLogsBySlug = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<'wfTriggerLogs'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    const results: Doc<'wfTriggerLogs'>[] = [];
    for await (const log of ctx.db
      .query('wfTriggerLogs')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )
      .order('desc')) {
      if (log.organizationId === args.organizationId) {
        results.push(log);
      }
    }
    return results;
  },
});
