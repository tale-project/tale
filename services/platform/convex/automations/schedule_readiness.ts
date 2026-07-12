import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  effectiveScheduleInput,
  missingRequiredScheduleFields,
  startInputSchemaOf,
} from './schedule_variables';

/** One ACTIVE schedule with the required start-schema fields it still leaves
 *  blank — built with direct property assignment, not a `.map()` spread (the
 *  `projectId` field is genuinely optional and `oxc/no-map-spread` flags a
 *  conditional spread inside a `map` callback). */
interface ScheduleReadinessRow {
  scheduleId: Id<'wfSchedules'>;
  cronExpression: string;
  projectId?: Id<'projects'>;
  missingFields: string[];
}

/**
 * Schedule-variable readiness for an automation's cron triggers — the third
 * readiness half next to `getAutomationInstallState` (integrations) and
 * `getAutomationAgentReadiness` (agents). A schedule fires the automation's
 * inline workflow with its row `variables` as `{{input.*}}`; when the
 * workflow's start schema marks fields required (e.g. GitHub `owner`/`repo`),
 * an active schedule missing them WILL fail at runtime, so the checklist and
 * the install wizard's Done step must name those gaps instead of claiming
 * ready. Judged on the EFFECTIVE fire-time input (`effectiveScheduleInput`):
 * a `projectId` carried by the schedule row itself never counts as missing.
 * Disabled schedules are skipped — they can't fire, and disabling is the
 * operator's explicit opt-out.
 */
export const getAutomationScheduleReadiness = action({
  args: { organizationId: v.string(), automationSlug: v.string() },
  returns: v.object({
    /** The start schema's required input fields ([] = nothing to configure). */
    required: v.array(v.string()),
    /** Every ACTIVE schedule, with the required fields it still leaves blank. */
    schedules: v.array(
      v.object({
        scheduleId: v.id('wfSchedules'),
        cronExpression: v.string(),
        projectId: v.optional(v.id('projects')),
        missingFields: v.array(v.string()),
      }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    required: string[];
    schedules: ScheduleReadinessRow[];
  }> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    // The automation's inline workflow shares its slug. A view-only automation
    // (no workflow) — or a deleted/corrupt file — has no schedule contract.
    const read = await ctx.runAction(api.workflows.file_actions.readWorkflow, {
      organizationId: args.organizationId,
      workflowSlug: args.automationSlug,
    });
    if (!read.ok) return { required: [], schedules: [] };

    const schema = startInputSchemaOf(read.config);
    const required = schema?.required ?? [];
    if (required.length === 0) return { required: [], schedules: [] };

    const rows = await ctx.runQuery(
      internal.workflows.triggers.internal_queries.getSchedulesBySlugInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.automationSlug,
      },
    );
    return {
      required,
      schedules: rows
        .filter((row) => row.isActive)
        .map((row): ScheduleReadinessRow => {
          const entry: ScheduleReadinessRow = {
            scheduleId: row._id,
            cronExpression: row.cronExpression,
            missingFields: missingRequiredScheduleFields(
              schema,
              effectiveScheduleInput(row.variables, row.projectId),
            ),
          };
          if (row.projectId !== undefined) entry.projectId = row.projectId;
          return entry;
        }),
    };
  },
});
