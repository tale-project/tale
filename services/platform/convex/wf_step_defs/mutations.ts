import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { mutationWithRLS } from '../lib/rls';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import { createStep as createStepHelper } from '../workflows/steps/create_step';
import { updateStep as updateStepHelper } from '../workflows/steps/update_step';
import {
  editModeValidator,
  stepTypeValidator,
} from '../workflows/steps/validators';
import { auditStepChange } from './audit';

export const updateStep = mutationWithRLS({
  args: {
    stepRecordId: v.id('wfStepDefs'),
    updates: jsonRecordValidator,
    editMode: editModeValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);

    const existing = await ctx.db.get(args.stepRecordId);
    if (!existing) {
      throw new Error('Step not found');
    }

    const beforeState = {
      stepSlug: existing.stepSlug,
      name: existing.name,
      stepType: existing.stepType,
      order: existing.order,
      config: existing.config,
      nextSteps: existing.nextSteps,
    };

    const updated = await updateStepHelper(ctx, {
      stepRecordId: args.stepRecordId,
      updates: args.updates,
    });

    if (updated) {
      const afterState = {
        stepSlug: updated.stepSlug,
        name: updated.name,
        stepType: updated.stepType,
        order: updated.order,
        config: updated.config,
        nextSteps: updated.nextSteps,
      };

      await auditStepChange(ctx, {
        stepId: args.stepRecordId,
        wfDefinitionId: existing.wfDefinitionId,
        organizationId: existing.organizationId,
        changedBy: user.userId,
        changeType: 'updated',
        editMode: args.editMode,
        before: beforeState,
        after: afterState,
      });
    }

    return updated;
  },
});

export const createStep = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    stepSlug: v.string(),
    name: v.string(),
    stepType: stepTypeValidator,
    order: v.number(),
    config: stepConfigValidator,
    nextSteps: v.record(v.string(), v.string()),
    editMode: editModeValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);

    const workflow = await ctx.db.get(args.wfDefinitionId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const stepId = await createStepHelper(ctx, {
      wfDefinitionId: args.wfDefinitionId,
      stepSlug: args.stepSlug,
      name: args.name,
      stepType: args.stepType,
      order: args.order,
      config: args.config,
      nextSteps: args.nextSteps,
      organizationId: workflow.organizationId,
    });

    const step = await ctx.db.get(stepId);

    if (step) {
      const afterState = {
        stepSlug: step.stepSlug,
        name: step.name,
        stepType: step.stepType,
        order: step.order,
        config: step.config,
        nextSteps: step.nextSteps,
      };

      await auditStepChange(ctx, {
        stepId,
        wfDefinitionId: args.wfDefinitionId,
        organizationId: workflow.organizationId,
        changedBy: user.userId,
        changeType: 'created',
        editMode: args.editMode,
        after: afterState,
      });
    }

    return stepId;
  },
});
