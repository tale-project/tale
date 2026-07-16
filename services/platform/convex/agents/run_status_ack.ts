/**
 * The shared "run admitted → task shows In progress" acknowledgement, used by
 * BOTH run paths — the inline LLM loop (`run_agent_on_task`) and the durable
 * sandbox exec (`node_only/sandbox/workflow_sandbox_exec`) — so the board
 * choreography can never diverge between runtimes. Strictly AFTER admission
 * (#2604): a refused run must not flash To do → In progress → To do.
 *
 * Which triggers ack:
 *  - `assignment` — always (the run-assigned pack owns the success/failure
 *    transitions: In review / roll back to To do).
 *  - `mention` — only when the mentioned agent IS the task's assignee and the
 *    task still sits at To do: that mention is a retry/continue of its
 *    assigned work, and the react-to-mentions pack completes the same
 *    choreography (In review on success, roll back on an admitted failure).
 *    Any other mention stays pure conversation and never moves the board.
 *  - everything else (revision/SLA/unblock/…) — no ack here; those packs own
 *    their own status choreography.
 */

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';

export interface RunAckTaskState {
  assigneeType?: string;
  assigneeId?: string;
  status: string;
}

/** Pure decision — unit-testable without a backend. `task` is only consulted
 * for mention runs (pass null when the task could not be loaded). */
export function shouldAckRunInProgress(args: {
  trigger?: string | undefined;
  agentSlug: string;
  task: RunAckTaskState | null;
}): boolean {
  if (args.trigger === 'assignment') return true;
  if (args.trigger !== 'mention') return false;
  const task = args.task;
  return (
    task !== null &&
    task.assigneeType === 'agent' &&
    task.assigneeId === args.agentSlug &&
    task.status === 'todo'
  );
}

export interface RunAckArgs {
  organizationId: string;
  agentSlug: string;
  taskId: Id<'tasks'>;
  trigger?: string | undefined;
  wfExecutionId?: string | undefined;
  workflowSlug?: string | undefined;
}

export async function ackRunInProgress(
  ctx: ActionCtx,
  args: RunAckArgs,
): Promise<void> {
  const needsTask = args.trigger === 'mention';
  const task = needsTask
    ? await ctx.runQuery(internal.tasks.internal_queries.getTaskByIdInternal, {
        taskId: args.taskId,
        organizationId: args.organizationId,
      })
    : null;
  if (!shouldAckRunInProgress({ ...args, task })) return;
  await ctx.runMutation(
    internal.tasks.internal_mutations.agentUpdateTaskStatus,
    {
      organizationId: args.organizationId,
      actorId: 'workflow',
      taskId: args.taskId,
      status: 'in_progress',
      attribution: {
        workflowSlug: args.workflowSlug,
        wfExecutionId: args.wfExecutionId
          ? toId<'wfExecutions'>(args.wfExecutionId)
          : undefined,
      },
    },
  );
}
