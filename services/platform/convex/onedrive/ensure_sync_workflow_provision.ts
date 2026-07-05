/**
 * Idempotent DB provisioning for the OneDrive sync-engine workflow.
 *
 * File copy lives in `ensure_sync_workflow.ts` (node). This module compensates
 * partial installs: missing `wfInstallations`, missing schedules, or
 * deactivated triggers — safe to run on every sync-config upsert.
 */

import { v } from 'convex/values';

import type { MutationCtx } from '../_generated/server';
import { internalMutation } from '../_generated/server';
import { upsertInstallationImpl } from '../workflows/installations';
import {
  provisionDeclaredWorkflowTriggersImpl,
  recordProvisionImpl,
} from '../workflows/provision_defaults_mutations';
import { ONEDRIVE_SYNC_WORKFLOW_SLUG } from './ensure_sync_workflow_constants';

const declaredEventValidator = v.object({
  eventType: v.string(),
  eventFilter: v.optional(v.record(v.string(), v.string())),
});

const declaredScheduleValidator = v.object({
  cron: v.string(),
  timezone: v.optional(v.string()),
  variables: v.optional(v.record(v.string(), v.any())),
});

export type DeclaredSchedule = {
  cron: string;
  timezone?: string;
  variables?: Record<string, unknown>;
};

export type SyncWorkflowProvisionResult = {
  /** `wfInstallations` row was absent before this run. */
  installationCreated: boolean;
  schedulesRequired: number;
  schedulesActive: number;
  schedulesCreated: number;
  schedulesReactivated: number;
  eventsCreated: number;
  /** Every declared schedule has an active row. */
  complete: boolean;
};

async function countActiveSchedulesForCrons(
  ctx: MutationCtx,
  organizationId: string,
  workflowSlug: string,
  schedules: readonly DeclaredSchedule[],
): Promise<number> {
  let active = 0;
  for (const declared of schedules) {
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', workflowSlug),
      )) {
      if (
        sched.organizationId === organizationId &&
        sched.cronExpression === declared.cron &&
        sched.projectId === undefined &&
        sched.isActive
      ) {
        active += 1;
        break;
      }
    }
  }
  return active;
}

/**
 * Upsert installation + declared triggers; re-activate deactivated rows.
 * Idempotent — repeated calls only fill gaps.
 */
export async function compensateSyncWorkflowEngineProvision(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    workflowSlug: string;
    contentHash: string;
    events?: Array<{
      eventType: string;
      eventFilter?: Record<string, string>;
    }>;
    schedules?: DeclaredSchedule[];
  },
): Promise<SyncWorkflowProvisionResult> {
  const schedules = args.schedules ?? [];

  const priorInstall = await ctx.db
    .query('wfInstallations')
    .withIndex('by_org_slug', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('workflowSlug', args.workflowSlug),
    )
    .first();

  await upsertInstallationImpl(ctx, {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    installedBy: 'system',
    contentHash: args.contentHash,
  });

  const triggers = await provisionDeclaredWorkflowTriggersImpl(ctx, {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    events: args.events,
    schedules,
    activate: true,
  });

  await recordProvisionImpl(ctx, {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    contentHash: args.contentHash,
  });

  const schedulesActive = await countActiveSchedulesForCrons(
    ctx,
    args.organizationId,
    args.workflowSlug,
    schedules,
  );

  const schedulesRequired = schedules.length;
  const complete =
    schedulesRequired === 0 || schedulesActive >= schedulesRequired;

  return {
    installationCreated: priorInstall === null,
    schedulesRequired,
    schedulesActive,
    schedulesCreated: triggers.schedulesCreated,
    schedulesReactivated: triggers.activated.schedules,
    eventsCreated: triggers.eventsCreated,
    complete,
  };
}

export const ensureSyncWorkflowEngineProvision = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.optional(v.string()),
    contentHash: v.string(),
    events: v.optional(v.array(declaredEventValidator)),
    schedules: v.optional(v.array(declaredScheduleValidator)),
  },
  returns: v.object({
    installationCreated: v.boolean(),
    schedulesRequired: v.number(),
    schedulesActive: v.number(),
    schedulesCreated: v.number(),
    schedulesReactivated: v.number(),
    eventsCreated: v.number(),
    complete: v.boolean(),
  }),
  handler: async (ctx, args) =>
    compensateSyncWorkflowEngineProvision(ctx, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug ?? ONEDRIVE_SYNC_WORKFLOW_SLUG,
      contentHash: args.contentHash,
      events: args.events,
      schedules: args.schedules,
    }),
});
