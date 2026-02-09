/**
 * Create workflow step
 */

import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { CreateStepArgs } from './types';

import { validateStepConfig } from '../../workflow_engine/helpers/validation/validate_step_config';

export async function createStep(
  ctx: MutationCtx,
  args: CreateStepArgs,
): Promise<Doc<'wfStepDefs'>['_id']> {
  const validation = validateStepConfig({
    stepSlug: args.stepSlug,
    name: args.name,
    stepType: args.stepType,
    config: args.config,
  });

  if (!validation.valid) {
    throw new Error(
      `Invalid step configuration: ${validation.errors.join(', ')}`,
    );
  }

  // Enforce single start step per workflow at the model layer
  if (args.stepType === 'start') {
    const existingStart = await ctx.db
      .query('wfStepDefs')
      .withIndex('by_definition', (q) =>
        q.eq('wfDefinitionId', args.wfDefinitionId),
      )
      .filter((q) => q.eq(q.field('stepType'), 'start'))
      .first();

    if (existingStart !== null) {
      throw new Error(
        'Workflow already has a start step. Only one start step per workflow is allowed.',
      );
    }
  }

  return await ctx.db.insert('wfStepDefs', {
    wfDefinitionId: args.wfDefinitionId,
    stepSlug: args.stepSlug,
    name: args.name,
    stepType: args.stepType,
    order: args.order,
    config: args.config,
    nextSteps: args.nextSteps,
    organizationId: args.organizationId,
  });
}
