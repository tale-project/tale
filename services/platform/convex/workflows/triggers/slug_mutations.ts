import { ConvexError, v } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../../lib/rls/organization/get_organization_member';
import { jsonRecordValidator } from '../../lib/validators/json';
import { isValidEventType } from './event_types';
import { generateToken } from './helpers/crypto';

// Nestable folders (`folder/subfolder/name`); `__` is the reserved URL
// separator and never allowed inside a segment. Mirror of the regex in
// `workflows/file_utils.ts` (kept in sync across the node/V8 boundary).
const WORKFLOW_SLUG_REGEX =
  /^(?!.*__)[a-z0-9][a-z0-9_-]*(\/(?!.*__)[a-z0-9][a-z0-9_-]*)*$/;

function validateWorkflowSlug(slug: string): boolean {
  return WORKFLOW_SLUG_REGEX.test(slug) && slug.length <= 128;
}

async function assertWorkflowInstalled(
  ctx: MutationCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<void> {
  const installation = await ctx.db
    .query('wfInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('workflowSlug', workflowSlug),
    )
    .first();
  if (!installation) {
    throw new ConvexError({ code: 'NOT_INSTALLED' });
  }
}

export const createScheduleBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    cronExpression: v.string(),
    timezone: v.string(),
    variables: v.optional(jsonRecordValidator),
  },
  returns: v.id('wfSchedules'),
  handler: async (ctx, args): Promise<Id<'wfSchedules'>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new ConvexError({ code: 'INVALID_SLUG', slug: args.workflowSlug });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    await assertWorkflowInstalled(ctx, args.organizationId, args.workflowSlug);

    return await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      cronExpression: args.cronExpression,
      timezone: args.timezone,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? authUser.userId,
      variables: args.variables,
    });
  },
});

export const toggleScheduleBySlug = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, schedule.organizationId, authUser);

    if (args.isActive && schedule.workflowSlug) {
      await assertWorkflowInstalled(
        ctx,
        schedule.organizationId,
        schedule.workflowSlug,
      );
    }

    await ctx.db.patch(args.scheduleId, { isActive: args.isActive });
    return null;
  },
});

export const updateScheduleBySlug = mutation({
  args: {
    scheduleId: v.id('wfSchedules'),
    cronExpression: v.string(),
    timezone: v.string(),
    variables: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, schedule.organizationId, authUser);

    await ctx.db.patch(args.scheduleId, {
      cronExpression: args.cronExpression,
      timezone: args.timezone,
      variables: args.variables,
    });
    return null;
  },
});

export const deleteScheduleBySlug = mutation({
  args: { scheduleId: v.id('wfSchedules') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const schedule = await ctx.db.get(args.scheduleId);
    if (!schedule) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, schedule.organizationId, authUser);

    await ctx.db.delete(args.scheduleId);
    return null;
  },
});

export const createWebhookBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({
    webhookId: v.id('wfWebhooks'),
    token: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ webhookId: Id<'wfWebhooks'>; token: string }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new ConvexError({ code: 'INVALID_SLUG', slug: args.workflowSlug });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    await assertWorkflowInstalled(ctx, args.organizationId, args.workflowSlug);

    const token = generateToken();

    const webhookId = await ctx.db.insert('wfWebhooks', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      token,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? authUser.userId,
    });

    return { webhookId, token };
  },
});

export const toggleWebhookBySlug = mutation({
  args: {
    webhookId: v.id('wfWebhooks'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, webhook.organizationId, authUser);

    if (args.isActive && webhook.workflowSlug) {
      await assertWorkflowInstalled(
        ctx,
        webhook.organizationId,
        webhook.workflowSlug,
      );
    }

    await ctx.db.patch(args.webhookId, { isActive: args.isActive });
    return null;
  },
});

export const deleteWebhookBySlug = mutation({
  args: { webhookId: v.id('wfWebhooks') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const webhook = await ctx.db.get(args.webhookId);
    if (!webhook) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, webhook.organizationId, authUser);

    await ctx.db.delete(args.webhookId);
    return null;
  },
});

/**
 * The app that owns a workflow slug, or `null` for a global/default-pack workflow.
 *
 * Ownership is a RECORDED fact: app install stamps `automationSlug` on the workflow's
 * `wfInstallations` row (`apps/install_actions.ts` registerWorkflow). We read that
 * field directly — no slug-prefix parsing (so no collision with a same-named
 * global workflow folder), and no dependence on the `automationInstallations` row still
 * existing. Takes only a db ctx (no auth) so it stays reusable + unit-testable.
 */
export async function automationOwnerOfWorkflowSlug(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<string | null> {
  const installation = await ctx.db
    .query('wfInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('workflowSlug', workflowSlug),
    )
    .first();
  return installation?.automationSlug ?? null;
}

/** Whether a workflow slug is owned by an app installed in this org. */
export async function isAutomationOwnedWorkflowSlug(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<boolean> {
  return (
    (await automationOwnerOfWorkflowSlug(ctx, organizationId, workflowSlug)) !==
    null
  );
}

export const createEventSubscriptionBySlug = mutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    eventType: v.string(),
    eventFilter: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id('wfEventSubscriptions'),
  handler: async (ctx, args): Promise<Id<'wfEventSubscriptions'>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new ConvexError({ code: 'INVALID_SLUG', slug: args.workflowSlug });
    }

    await getOrganizationMember(ctx, args.organizationId, authUser);

    // An app is an internally-scoped scenario: its workflow runs only from within
    // the app (its create action / per-workflow webhook), never off an org-global
    // event that other apps/channels also emit. The auto path already skips event
    // registration on app install (apps/install_actions.ts registerWorkflow); this
    // is the manual/Workflows path's equivalent guard.
    if (
      await isAutomationOwnedWorkflowSlug(
        ctx,
        args.organizationId,
        args.workflowSlug,
      )
    ) {
      throw new ConvexError({
        code: 'AUTOMATION_OWNED_WORKFLOW',
        slug: args.workflowSlug,
      });
    }

    if (!isValidEventType(args.eventType)) {
      throw new ConvexError({
        code: 'INVALID_EVENT_TYPE',
        eventType: String(args.eventType),
      });
    }

    await assertWorkflowInstalled(ctx, args.organizationId, args.workflowSlug);

    const existing = await ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('organizationId'), args.organizationId),
          q.eq(q.field('eventType'), args.eventType),
        ),
      )
      .first();

    if (existing) {
      throw new ConvexError({
        code: 'DUPLICATE_SUBSCRIPTION',
        eventType: args.eventType,
      });
    }

    const cleanFilter =
      args.eventFilter && Object.keys(args.eventFilter).length > 0
        ? args.eventFilter
        : undefined;

    const insertData = {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      eventType: args.eventType,
      isActive: true,
      createdAt: Date.now(),
      createdBy: authUser.email ?? authUser.userId,
      ...(cleanFilter !== undefined && { eventFilter: cleanFilter }),
    };
    return await ctx.db.insert('wfEventSubscriptions', insertData);
  },
});

export const toggleEventSubscriptionBySlug = mutation({
  args: {
    subscriptionId: v.id('wfEventSubscriptions'),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, sub.organizationId, authUser);

    if (args.isActive && sub.workflowSlug) {
      await assertWorkflowInstalled(ctx, sub.organizationId, sub.workflowSlug);
    }

    await ctx.db.patch(args.subscriptionId, { isActive: args.isActive });
    return null;
  },
});

export const updateEventSubscriptionBySlug = mutation({
  args: {
    subscriptionId: v.id('wfEventSubscriptions'),
    eventFilter: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, sub.organizationId, authUser);

    await ctx.db.patch(args.subscriptionId, {
      eventFilter: args.eventFilter,
    });
    return null;
  },
});

export const deleteEventSubscriptionBySlug = mutation({
  args: { subscriptionId: v.id('wfEventSubscriptions') },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new ConvexError({ code: 'NOT_FOUND' });

    await getOrganizationMember(ctx, sub.organizationId, authUser);

    await ctx.db.delete(args.subscriptionId);
    return null;
  },
});
