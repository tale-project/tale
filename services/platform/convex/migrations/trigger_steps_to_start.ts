/**
 * Migration: Convert legacy 'trigger' steps to 'start' steps.
 *
 * Legacy workflows use stepType='trigger' with trigger config embedded in step config.
 * Modern workflows use stepType='start' with external trigger tables (wfSchedules, etc.).
 *
 * This migration:
 * 1. Finds all wfStepDefs with stepType='trigger'
 * 2. For scheduled triggers: creates a wfSchedules record
 * 3. Updates stepType to 'start' with clean config
 *
 * Bounded per invocation: it walks `wfStepDefs` one page at a time so a large
 * deployment can't blow the per-mutation read/write budget (the prior
 * unbounded `.collect()` would throw and leave the migration half-applied).
 * Re-run with the returned `continueCursor` until `isDone` is true.
 *
 * Usage:
 *   bunx convex run migrations/trigger_steps_to_start:migrateTriggerStepsToStart
 *   # then, while isDone === false:
 *   bunx convex run migrations/trigger_steps_to_start:migrateTriggerStepsToStart '{"cursor":"<continueCursor>"}'
 */

import { v } from 'convex/values';

import { getString } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';

const PAGE_SIZE = 200;

export const migrateTriggerStepsToStart = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('wfStepDefs')
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    const triggerSteps = result.page.filter((s) => s.stepType === 'trigger');

    let stepsUpdated = 0;
    let schedulesCreated = 0;
    let skipped = 0;
    const details: Array<{
      stepId: string;
      stepSlug: string;
      workflowId: string;
      triggerType: string;
      scheduleCreated: boolean;
    }> = [];

    for (const step of triggerSteps) {
      const cfg = step.config as Record<string, unknown> | undefined;
      const triggerType =
        (cfg ? getString(cfg, 'type') : undefined) ?? 'unknown';

      const wfDefinition = await ctx.db.get(step.wfDefinitionId);
      if (!wfDefinition) {
        skipped++;
        continue;
      }

      if (triggerType === 'scheduled') {
        const schedule = cfg ? getString(cfg, 'schedule') : undefined;
        const timezone =
          ((cfg ? getString(cfg, 'timezone') : undefined) || '').trim() ||
          'UTC';

        if (schedule && schedule.trim() !== '') {
          const workflowRootId = wfDefinition.rootVersionId ?? wfDefinition._id;

          const existingSchedule = await ctx.db
            .query('wfSchedules')
            .withIndex('by_workflowRoot', (q) =>
              q.eq('workflowRootId', workflowRootId),
            )
            .first();

          if (!existingSchedule) {
            await ctx.db.insert('wfSchedules', {
              organizationId: wfDefinition.organizationId,
              workflowRootId,
              cronExpression: schedule.trim(),
              timezone,
              isActive: wfDefinition.status === 'active',
              createdAt: Date.now(),
              createdBy: 'migration:trigger_steps_to_start',
            });
            schedulesCreated++;
          }

          details.push({
            stepId: step._id,
            stepSlug: step.stepSlug,
            workflowId: step.wfDefinitionId,
            triggerType,
            scheduleCreated: !existingSchedule,
          });
        }
      } else {
        details.push({
          stepId: step._id,
          stepSlug: step.stepSlug,
          workflowId: step.wfDefinitionId,
          triggerType,
          scheduleCreated: false,
        });
      }

      await ctx.db.patch(step._id, {
        stepType: 'start',
        config: {},
      });
      stepsUpdated++;
    }

    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      pageSize: result.page.length,
      triggerStepsFound: triggerSteps.length,
      stepsUpdated,
      schedulesCreated,
      skipped,
      details,
    };
  },
});
