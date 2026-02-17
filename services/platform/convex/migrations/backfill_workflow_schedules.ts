/**
 * Migration: Backfill wfSchedules for start steps with scheduled config.
 *
 * Workflows provisioned before publishDraft synced schedules may have a
 * start step with `{ type: 'scheduled', schedule: '...', timezone: '...' }`
 * but no corresponding wfSchedules record. This migration creates them.
 *
 * Usage:
 *   npx convex run migrations/backfill_workflow_schedules:backfillWorkflowSchedules
 */

import { getString } from '../../lib/utils/type-guards';
import { internalMutation } from '../_generated/server';

export const backfillWorkflowSchedules = internalMutation({
  args: {},
  handler: async (ctx) => {
    let schedulesCreated = 0;
    let skipped = 0;

    for await (const step of ctx.db.query('wfStepDefs')) {
      if (step.stepType !== 'start') continue;

      const cfg = step.config as Record<string, unknown> | undefined;
      const triggerType = cfg ? getString(cfg, 'type') : undefined;
      if (triggerType !== 'scheduled') continue;

      const schedule = cfg ? getString(cfg, 'schedule') : undefined;
      const timezone =
        ((cfg ? getString(cfg, 'timezone') : undefined) || '').trim() || 'UTC';

      if (!schedule || schedule.trim() === '') {
        skipped++;
        continue;
      }

      const wfDefinition = await ctx.db.get(step.wfDefinitionId);
      if (!wfDefinition || wfDefinition.status !== 'active') {
        skipped++;
        continue;
      }

      const workflowRootId = wfDefinition.rootVersionId ?? wfDefinition._id;

      const existingSchedule = await ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowRoot', (q) =>
          q.eq('workflowRootId', workflowRootId),
        )
        .first();

      if (existingSchedule) {
        skipped++;
        continue;
      }

      await ctx.db.insert('wfSchedules', {
        organizationId: wfDefinition.organizationId,
        workflowRootId,
        cronExpression: schedule.trim(),
        timezone,
        isActive: true,
        createdAt: Date.now(),
        createdBy: 'migration:backfill_workflow_schedules',
      });
      schedulesCreated++;
    }

    return { schedulesCreated, skipped };
  },
});
