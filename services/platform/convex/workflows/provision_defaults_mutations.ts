/**
 * DB half of the default-workflow provisioner (V8; the file reads live in
 * `provision_defaults.ts`, a node action).
 *
 * Trigger rows are CREATE-IF-ABSENT only: a row matching the declared
 * trigger's identity (event: org+slug+eventType; schedule: org+slug+cron)
 * is never modified — org edits to filters/timezones/isActive always win,
 * including `isActive: false` (a deactivated default trigger stays off).
 */

import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';

export const getProvision = internalQuery({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.union(v.null(), v.object({ contentHash: v.string() })),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('wfDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    return row ? { contentHash: row.contentHash } : null;
  },
});

export async function recordProvisionImpl(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    workflowSlug: string;
    contentHash: string;
  },
): Promise<null> {
  const existing = await ctx.db
    .query('wfDefaultProvisions')
    .withIndex('by_org_slug', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('workflowSlug', args.workflowSlug),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      contentHash: args.contentHash,
      provisionedAt: Date.now(),
    });
    return null;
  }
  await ctx.db.insert('wfDefaultProvisions', {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    contentHash: args.contentHash,
    provisionedAt: Date.now(),
  });
  return null;
}

export const recordProvision = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    contentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => recordProvisionImpl(ctx, args),
});

export const ensureEventSubscription = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    eventType: v.string(),
    eventFilter: v.optional(v.record(v.string(), v.string())),
    isActive: v.boolean(),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org_eventType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('eventType', args.eventType),
      )) {
      if (sub.workflowSlug === args.workflowSlug) {
        return { created: false };
      }
    }
    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      eventType: args.eventType,
      eventFilter: args.eventFilter,
      isActive: args.isActive,
      createdAt: Date.now(),
      createdBy: 'system',
    });
    return { created: true };
  },
});

export const ensureSchedule = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    /**
     * Project this schedule belongs to for a `scope: 'project'` app (one schedule
     * per bound project, each carrying that project's config in `variables`).
     * Undefined for org-level schedules. Part of the idempotency key, so the same
     * (org, workflowSlug, cron) yields a SEPARATE row per project.
     */
    projectId: v.optional(v.id('projects')),
    cronExpression: v.string(),
    timezone: v.optional(v.string()),
    variables: v.optional(jsonRecordValidator),
    isActive: v.boolean(),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (
        sched.organizationId === args.organizationId &&
        sched.cronExpression === args.cronExpression &&
        sched.projectId === args.projectId
      ) {
        return { created: false };
      }
    }
    await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      workflowSlug: args.workflowSlug,
      cronExpression: args.cronExpression,
      timezone: args.timezone ?? 'UTC',
      variables: args.variables,
      isActive: args.isActive,
      createdAt: Date.now(),
      createdBy: 'system',
    });
    return { created: true };
  },
});

/**
 * Flip `isActive` on every trigger row belonging to the given workflow
 * slugs — the master-toggle / kill-switch lever. Never touches rows of
 * other workflows; returns counts for the audit trail.
 */
const declaredEventValidator = v.object({
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
});

const declaredScheduleValidator = v.object({
  cron: v.string(),
  timezone: v.optional(v.string()),
  variables: v.optional(jsonRecordValidator),
});

/**
 * Create trigger rows declared in a workflow JSON file (create-if-absent).
 * Used by the default-workflow provisioner, integration bundles, catalog
 * install, and the OneDrive sync-engine ensure path.
 */
export type ProvisionDeclaredWorkflowTriggersResult = {
  eventsCreated: number;
  schedulesCreated: number;
  activated: { events: number; schedules: number };
};

export async function provisionDeclaredWorkflowTriggersImpl(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    workflowSlug: string;
    events?: Array<{
      eventType: string;
      eventFilter?: Record<string, string>;
    }>;
    schedules?: Array<{
      cron: string;
      timezone?: string;
      variables?: Record<string, unknown>;
    }>;
    activate?: boolean;
  },
): Promise<ProvisionDeclaredWorkflowTriggersResult> {
  let eventsCreated = 0;
  let schedulesCreated = 0;

  for (const event of args.events ?? []) {
    let exists = false;
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org_eventType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('eventType', event.eventType),
      )) {
      if (sub.workflowSlug === args.workflowSlug) {
        exists = true;
        break;
      }
    }
    if (exists) continue;

    await ctx.db.insert('wfEventSubscriptions', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      eventType: event.eventType,
      eventFilter: event.eventFilter,
      isActive: true,
      createdAt: Date.now(),
      createdBy: 'system',
    });
    eventsCreated += 1;
  }

  for (const schedule of args.schedules ?? []) {
    let exists = false;
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (
        sched.organizationId === args.organizationId &&
        sched.cronExpression === schedule.cron &&
        sched.projectId === undefined
      ) {
        exists = true;
        break;
      }
    }
    if (exists) continue;

    await ctx.db.insert('wfSchedules', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      cronExpression: schedule.cron,
      timezone: schedule.timezone ?? 'UTC',
      variables: schedule.variables,
      isActive: true,
      createdAt: Date.now(),
      createdBy: 'system',
    });
    schedulesCreated += 1;
  }

  let activated = { events: 0, schedules: 0 };
  if (args.activate) {
    const slugs = [args.workflowSlug];
    let events = 0;
    let schedules = 0;
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!sub.workflowSlug || !slugs.includes(sub.workflowSlug)) continue;
      if (sub.isActive !== true) {
        await ctx.db.patch(sub._id, { isActive: true });
        events += 1;
      }
    }
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!sched.workflowSlug || !slugs.includes(sched.workflowSlug)) continue;
      if (sched.isActive !== true) {
        await ctx.db.patch(sched._id, { isActive: true });
        schedules += 1;
      }
    }
    activated = { events, schedules };
  }

  return { eventsCreated, schedulesCreated, activated };
}

export const provisionDeclaredWorkflowTriggers = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    events: v.optional(v.array(declaredEventValidator)),
    schedules: v.optional(v.array(declaredScheduleValidator)),
    /** Re-enable existing rows for this slug after create-if-absent. */
    activate: v.optional(v.boolean()),
  },
  returns: v.object({
    eventsCreated: v.number(),
    schedulesCreated: v.number(),
    activated: v.object({ events: v.number(), schedules: v.number() }),
  }),
  handler: async (ctx, args) =>
    provisionDeclaredWorkflowTriggersImpl(ctx, args),
});

export const setTriggersActiveForSlugs = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlugs: v.array(v.string()),
    isActive: v.boolean(),
  },
  returns: v.object({ events: v.number(), schedules: v.number() }),
  handler: async (ctx, args) => {
    const slugs = new Set(args.workflowSlugs);
    let events = 0;
    let schedules = 0;
    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!sub.workflowSlug || !slugs.has(sub.workflowSlug)) continue;
      if (sub.isActive !== args.isActive) {
        await ctx.db.patch(sub._id, { isActive: args.isActive });
        events += 1;
      }
    }
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (!sched.workflowSlug || !slugs.has(sched.workflowSlug)) continue;
      if (sched.isActive !== args.isActive) {
        await ctx.db.patch(sched._id, { isActive: args.isActive });
        schedules += 1;
      }
    }
    return { events, schedules };
  },
});
