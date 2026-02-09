/**
 * Duplicate a workflow definition and all of its steps.
 */

import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface DuplicateWorkflowArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  newName?: string;
}

export async function duplicateWorkflow(
  ctx: MutationCtx,
  args: DuplicateWorkflowArgs,
): Promise<Id<'wfDefinitions'>> {
  // Load source workflow
  const source = (await ctx.db.get(
    args.wfDefinitionId,
  )) as Doc<'wfDefinitions'> | null;

  if (!source) {
    throw new Error('Workflow not found');
  }

  // Create new workflow (draft v1) using the same config
  const newWorkflowId = await ctx.db.insert('wfDefinitions', {
    organizationId: source.organizationId,
    name: args.newName || `${source.name} (Copy)`,
    description: source.description,
    category: source.category,
    version: 'v1',
    versionNumber: 1,
    status: 'draft',
    workflowType: source.workflowType,
    config: source.config || {},
    rootVersionId: undefined,
    metadata: {
      ...source.metadata,
      createdAt: Date.now(),
      createdBy: 'user',
      duplicatedFrom: source._id,
    },
  });

  // For duplicated workflows, treat the new workflow as the root of its own family
  await ctx.db.patch(newWorkflowId, {
    rootVersionId: newWorkflowId,
  });

  // Collect steps from the source workflow
  const steps: Array<Doc<'wfStepDefs'>> = [];
  for await (const step of ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) =>
      q.eq('wfDefinitionId', args.wfDefinitionId),
    )) {
    steps.push(step);
  }

  // Copy all steps in parallel
  await Promise.all(
    steps.map((step) =>
      ctx.db.insert('wfStepDefs', {
        organizationId: step.organizationId,
        wfDefinitionId: newWorkflowId,
        stepSlug: step.stepSlug, // stepSlug uniqueness is per workflow
        name: step.name,
        stepType: step.stepType,
        order: step.order,
        config: step.config,
        nextSteps: step.nextSteps,
        metadata: step.metadata,
      }),
    ),
  );

  return newWorkflowId;
}
