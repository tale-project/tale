/**
 * Delete workflow
 */

import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { WorkflowId } from '@convex-dev/workflow';
import { internal } from '../../_generated/api';
import { workflowManager } from '../../workflow/engine';

export async function deleteWorkflow(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<null> {
  const workflow = await ctx.db.get(wfDefinitionId);
  if (!workflow) {
    return null;
  }

  const rootVersionId = (workflow as any).rootVersionId as
    | Id<'wfDefinitions'>
    | undefined;

  // If this is the root version (rootVersionId points to this document), delete the whole family.
  if (rootVersionId && rootVersionId === workflow._id) {
    const allVersions = await ctx.db
      .query('wfDefinitions')
      .withIndex('by_rootVersionId', (q) =>
        q.eq('rootVersionId', rootVersionId),
      )
      .collect();

    for (const version of allVersions) {
      await cancelAndDeleteExecutionsForDefinition(ctx, version._id);
      await deleteStepsForDefinition(ctx, version._id);
      await ctx.db.delete(version._id);
    }

    return null;
  }

  // Backwards-compatible behavior: if this is not a root version (or predates rootVersionId),
  // delete only this workflow and its steps (and all executions for this definition).
  await cancelAndDeleteExecutionsForDefinition(ctx, wfDefinitionId);
  await deleteStepsForDefinition(ctx, wfDefinitionId);
  await ctx.db.delete(wfDefinitionId);
  return null;
}

async function cancelAndDeleteExecutionsForDefinition(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<void> {
  const executionsByDefinition = ctx.db
    .query('wfExecutions')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId));

  // Stream over executions to avoid loading large result sets into memory.
  for await (const execution of executionsByDefinition) {
    const isInProgress =
      execution.status !== 'completed' && execution.status !== 'failed';

    if (execution.componentWorkflowId) {
      const componentWorkflowId =
        execution.componentWorkflowId as unknown as WorkflowId;

      if (isInProgress) {
        // Cancel any in-progress underlying component workflow.
        await workflowManager.cancel(ctx, componentWorkflowId);

        // Schedule cleanup after a short delay to avoid racing with the
        // workflow engine's own cancellation/onComplete logic, which still
        // expects the journal entry to exist for a brief period.
        await ctx.scheduler.runAfter(
          10_000,
          internal.workflow.engine.cleanupComponentWorkflow,
          {
            workflowId: componentWorkflowId,
          },
        );
      } else {
        // For completed/failed workflows, it's safe to fully remove the
        // underlying component workflow so its journal/state is removed from
        // the workflow component tables.
        await workflowManager.cleanup(ctx, componentWorkflowId);
      }
    }

    // Delete the execution record regardless of status.
    await ctx.db.delete(execution._id);
  }
}

async function deleteStepsForDefinition(
  ctx: MutationCtx,
  wfDefinitionId: Id<'wfDefinitions'>,
): Promise<void> {
  const steps = await ctx.db
    .query('wfStepDefs')
    .withIndex('by_definition', (q) => q.eq('wfDefinitionId', wfDefinitionId))
    .collect();

  for (const step of steps) {
    await ctx.db.delete(step._id);
  }
}
