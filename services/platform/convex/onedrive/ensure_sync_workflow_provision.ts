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
  /** Active org-level schedule rows for this automation (any cron). */
  schedulesActive: number;
  schedulesCreated: number;
  schedulesReactivated: number;
  eventsCreated: number;
  /** The automation has at least one active schedule. */
  complete: boolean;
};

/**
 * Org-level (project-less) schedule rows for this automation, regardless of
 * cron or active state. The sync engine owns a single, retunable schedule, so
 * provisioning keys on the automation — not on the builtin's exact cron: an
 * operator who changes the interval must not get a second trigger bolted on.
 */
async function listAutomationSchedules(
  ctx: MutationCtx,
  organizationId: string,
  workflowSlug: string,
): Promise<Array<{ isActive: boolean }>> {
  const rows: Array<{ isActive: boolean }> = [];
  for await (const sched of ctx.db
    .query('wfSchedules')
    .withIndex('by_workflowSlug', (q) => q.eq('workflowSlug', workflowSlug))) {
    if (
      sched.organizationId === organizationId &&
      sched.projectId === undefined
    ) {
      rows.push({ isActive: sched.isActive });
    }
  }
  return rows;
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

  // A schedule row already present for this automation — even one the operator
  // retuned to a different interval, or paused — is authoritative. Only declare
  // the builtin schedule when none exists yet; otherwise `activate: true` below
  // just revives it. This is what stops a divergent builtin cron from being
  // inserted as a second, concurrently-firing trigger.
  const priorSchedules = await listAutomationSchedules(
    ctx,
    args.organizationId,
    args.workflowSlug,
  );
  const declareSchedules = priorSchedules.length === 0 ? schedules : [];

  const triggers = await provisionDeclaredWorkflowTriggersImpl(ctx, {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    events: args.events,
    schedules: declareSchedules,
    activate: true,
  });

  await recordProvisionImpl(ctx, {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    contentHash: args.contentHash,
  });

  const schedulesActive = (
    await listAutomationSchedules(ctx, args.organizationId, args.workflowSlug)
  ).filter((sched) => sched.isActive).length;

  const schedulesRequired = schedules.length;
  const complete = schedulesRequired === 0 || schedulesActive >= 1;

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
