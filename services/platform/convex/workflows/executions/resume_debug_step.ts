/**
 * Resume a debug-paused execution: send the `debug:<pauseIndex>` event the
 * engine's pause gate is awaiting (see workflow_engine/helpers/engine/
 * debug_gate.ts). 'step' runs the paused node and pauses again before the
 * next one; 'continue' runs to the end without further pauses.
 */

import type { WorkflowId } from '@convex-dev/workflow';

import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { workflowManagers } from '../../workflow_engine/engine';
import type { DebugResumeAction } from '../../workflow_engine/helpers/engine/debug_gate';
import {
  debugEventName,
  parseDebugWaitingFor,
} from '../../workflow_engine/helpers/engine/debug_gate';
import { safeShardIndex } from '../../workflow_engine/helpers/engine/shard';

export interface ResumeDebugStepArgs {
  executionId: Id<'wfExecutions'>;
  action: DebugResumeAction;
}

export async function resumeDebugStep(
  ctx: MutationCtx,
  args: ResumeDebugStepArgs,
): Promise<null> {
  const execution = await ctx.db.get(args.executionId);
  if (!execution) {
    throw new Error('Execution not found');
  }

  if (execution.status !== 'running') {
    throw new Error(
      `Cannot resume a debug step on execution with status "${execution.status}"`,
    );
  }

  const pause = parseDebugWaitingFor(execution.waitingFor);
  if (!pause) {
    throw new Error('Execution is not paused in debug mode');
  }

  if (!execution.componentWorkflowId) {
    throw new Error('Execution is missing its component workflow ID');
  }

  const manager = workflowManagers[safeShardIndex(execution.shardIndex)];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- componentWorkflowId stored as string, WorkflowId is a branded type
  const workflowId = execution.componentWorkflowId as unknown as WorkflowId;

  await manager.sendEvent(ctx, {
    workflowId,
    name: debugEventName(pause.pauseIndex),
    value: { action: args.action },
  });

  return null;
}
