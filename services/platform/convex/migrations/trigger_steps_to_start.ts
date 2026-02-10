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
 * Usage:
 *   npx convex run migrations/trigger_steps_to_start:migrateTriggerStepsToStart
 */

import { getString } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';

export const migrateTriggerStepsToStart = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allSteps = await ctx.db.query('wfStepDefs').collect();
    const triggerSteps = allSteps.filter((s) => s.stepType === 'trigger');

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
      totalSteps: allSteps.length,
      triggerStepsFound: triggerSteps.length,
      stepsUpdated,
      schedulesCreated,
      skipped,
      details,
    };
  },
});
