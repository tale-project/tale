/**
 * Workflow completion hook business logic
 *
 * Handles the logic when a workflow completes execution.
 * This is the sole authority for transitioning execution status to terminal
 * states (completed/failed). The serialize action persists output and variables
 * before this callback fires.
 */

import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import type { ComponentRunResult } from '../../types';

import { isRecord, getString } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';
import { emitEvent } from '../../../workflows/triggers/emit_event';

export async function handleWorkflowComplete(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    context: unknown;
    result: unknown;
  },
): Promise<void> {
  const ctxRecord = isRecord(args.context) ? args.context : null;
  const executionIdStr = ctxRecord
    ? getString(ctxRecord, 'executionId')
    : undefined;
  let exec: Doc<'wfExecutions'> | null = null;
  if (executionIdStr) {
    exec = await ctx.db.get(toId<'wfExecutions'>(executionIdStr));
  }
  if (!exec) {
    exec = await ctx.db
      .query('wfExecutions')
      .withIndex('by_component_workflow', (q) =>
        q.eq('componentWorkflowId', args.workflowId),
      )
      .first();
  }
  if (!exec) return;

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- args.result comes from @convex-dev/workflow component callback; shape is ComponentRunResult at runtime
  const result = args.result as ComponentRunResult;
  const kind = result?.kind;

  // Track the pre-completion status so postCompletionMessageToThread can detect
  // first-time vs re-invocation
  const wasTerminal = exec.status === 'completed' || exec.status === 'failed';

  if (kind === 'success') {
    // Only transition to completed if not already done (the serialize action
    // does NOT set status; this callback is the sole completion authority).
    // The idempotency guard in completeExecution also protects against races.
    if (!wasTerminal) {
      // Use the already-persisted output from the serialize action.
      const output = exec.output ?? null;
      await ctx.runMutation(
        internal.wf_executions.internal_mutations.completeExecution,
        {
          executionId: toId<'wfExecutions'>(exec._id),
          output,
        },
      );
    }
    const updatedExec = await ctx.db.get(exec._id);
    if (updatedExec) {
      await emitEvent(ctx, {
        organizationId: updatedExec.organizationId,
        eventType: 'workflow.completed',
        eventData: { execution: updatedExec },
      });
    }
  } else if (kind === 'failed') {
    await ctx.runMutation(
      internal.wf_executions.internal_mutations.failExecution,
      {
        executionId: toId<'wfExecutions'>(exec._id),
        error: result.error || 'failed',
      },
    );
  } else if (kind === 'canceled') {
    await ctx.runMutation(
      internal.wf_executions.internal_mutations.updateExecutionStatus,
      {
        executionId: toId<'wfExecutions'>(exec._id),
        status: 'failed',
        error: 'canceled',
      },
    );
  }

  if (!wasTerminal) {
    // Mark the triggering approval as completed/rejected now that the workflow is done
    await updateTriggeringApprovalStatus(ctx, exec, kind);
    // Skip completion message for canceled workflows — cancelExecution
    // already posts [WORKFLOW_CANCELLED] to the thread
    if (kind !== 'canceled') {
      await postCompletionMessageToThread(ctx, exec, kind, result);
    }
  }
}

async function updateTriggeringApprovalStatus(
  ctx: MutationCtx,
  exec: Doc<'wfExecutions'>,
  kind: string | undefined,
): Promise<void> {
  const triggerData = isRecord(exec.triggerData) ? exec.triggerData : null;
  const approvalIdStr = triggerData
    ? getString(triggerData, 'approvalId')
    : undefined;
  if (!approvalIdStr) return;

  try {
    const approval = await ctx.db.get(toId<'approvals'>(approvalIdStr));
    if (!approval || approval.status !== 'executing') return;

    await ctx.db.patch(approval._id, {
      status: kind === 'success' ? 'completed' : 'rejected',
      ...(kind !== 'success'
        ? { executionError: exec.error ?? 'Workflow failed' }
        : {}),
    });
  } catch {
    // Non-critical: approval status update failure should not block completion
  }
}

async function postCompletionMessageToThread(
  ctx: MutationCtx,
  exec: Doc<'wfExecutions'>,
  kind: string | undefined,
  result: ComponentRunResult,
): Promise<void> {
  const triggerData = isRecord(exec.triggerData) ? exec.triggerData : null;
  const approvalIdStr = triggerData
    ? getString(triggerData, 'approvalId')
    : undefined;
  if (!approvalIdStr) return;

  try {
    const approval = await ctx.db.get(toId<'approvals'>(approvalIdStr));
    if (!approval?.threadId) return;

    const workflowName = exec.workflowSlug || 'unknown';
    const errorMsg = result.kind === 'failed' ? result.error : 'unknown error';

    // Read the persisted output for the summary instead of using
    // result.returnValue (which is void for dynamic workflows)
    let outputSummary = '';
    if (kind === 'success') {
      try {
        const freshExec = await ctx.db.get(exec._id);
        if (freshExec?.output) {
          const raw = JSON.stringify(freshExec.output, null, 2);
          if (!raw.includes('_storageRef')) {
            outputSummary = `\n\nWorkflow Output:\n${raw.slice(0, 8000)}`;
          }
        }
      } catch {
        // Non-critical: skip output if serialization fails
      }
    }

    const messageContent =
      kind === 'success'
        ? `[WORKFLOW_COMPLETED]\nWorkflow "${workflowName}" completed successfully.\n\nExecution Details:\n- Execution ID: ${exec._id}\n- Status: completed${outputSummary}\n\nInstructions:\n- Inform the user that the workflow has completed successfully and present the output details\n- If the output contains file download links (downloadUrl), present them to the user so they can download the files`
        : `[WORKFLOW_FAILED]\nWorkflow "${workflowName}" failed.\n\nExecution Details:\n- Execution ID: ${exec._id}\n- Status: failed\n- Error: ${errorMsg || 'unknown error'}\n\nInstructions:\n- Inform the user that the workflow has failed and provide the error details`;

    // Resolve agentSlug from thread metadata to load full agent config
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) =>
        q.eq('threadId', String(approval.threadId)),
      )
      .first();
    const agentSlug = threadMeta?.agentSlug;

    if (agentSlug) {
      await ctx.scheduler.runAfter(
        0,
        internal.agent_tools.workflows.trigger_completion_action
          .triggerCompletionWithAgent,
        {
          threadId: approval.threadId,
          organizationId: exec.organizationId,
          agentSlug,
          messageContent,
        },
      );
    } else {
      // Fallback for legacy threads without agentSlug: save the system message
      // directly so the user still sees the workflow result, but skip agent generation
      await ctx.scheduler.runAfter(
        0,
        internal.agent_tools.workflows.internal_mutations.saveSystemMessage,
        {
          threadId: approval.threadId,
          content: messageContent,
        },
      );
    }
  } catch {
    // Completion response trigger failure is non-critical; execution status is already persisted
  }
}
