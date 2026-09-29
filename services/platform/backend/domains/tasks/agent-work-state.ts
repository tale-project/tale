import type { Sql } from 'postgres';

import type { RunSummary } from '../../../lib/engine/api/dispatch.ts';
import { getPendingAskForRun, runWaitingFor } from '../automations/store.ts';
import {
  listTaskAgentRunSummaries,
  type TaskAgentRunSummary,
} from './agent-runs.ts';
import {
  findLatestAutomationRunForTask,
  findLiveAutomationRunForTask,
} from './external-ref.ts';
import { getPendingReviewForTask } from './reviews.ts';

/**
 * What is working on a task, and what waits on a person — the run half of an
 * agent's `task_get`, read with the readers the task sheet uses: its run
 * list, its automation banner and Run row, the ask card and the review gate.
 * A task has at most one live run of each family (migrations 0080 and 0104),
 * so "the live one" is exact.
 *
 * The caller has scope-checked the task and passes its project: every read is
 * bound to the task (and the automation run to the task's own project), so
 * nothing here reaches past it.
 */

/** A live automation run: the statuses the start guard counts as holding
 * the task. */
const LIVE_AUTOMATION_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'waiting',
]);

export interface TaskWorkflowRunState {
  runId: string;
  /** The automation's name. */
  automation: string;
  status: string;
  live: boolean;
  /** What a `waiting` run is parked on (`runWaitingFor`): `ask` and
   * `approval` wait on a person, `agent` and `repeat` on the run itself. */
  waitingFor?: NonNullable<RunSummary['waitingFor']>;
  /** The unanswered `ask_human` question the run waits on. */
  ask?: { askId: string; createdAt: number; expiresAt: number };
  /** The approval card the run waits on. */
  approvalId?: string;
}

export interface TaskWorkState {
  /** Newest first — the first is the live run when the task has one. */
  agentRuns: TaskAgentRunSummary[];
  /** Whether older runs than this page exist. */
  agentRunsHasMore: boolean;
  /** The live automation run, else the latest one, else null. */
  workflowRun: TaskWorkflowRunState | null;
  /** The task's open review, which only a person decides. */
  pendingReview: {
    approvalId: string;
    round: number;
    runId: string | null;
    requestedFor: string | null;
    createdAt: number;
  } | null;
}

export async function readTaskWorkState(
  sql: Sql,
  args: {
    organizationId: string;
    projectId: string;
    taskId: string;
    runLimit: number;
    /** Continue an earlier page: only runs created before this one. */
    runsBeforeSeq?: number;
  },
): Promise<TaskWorkState> {
  const runs = await listTaskAgentRunSummaries(sql, {
    organizationId: args.organizationId,
    taskId: args.taskId,
    limit: args.runLimit + 1,
    ...(args.runsBeforeSeq !== undefined
      ? { beforeSeq: args.runsBeforeSeq }
      : {}),
  });
  const subject = {
    organizationId: args.organizationId,
    projectId: args.projectId,
    taskId: args.taskId,
  };
  const automation =
    (await findLiveAutomationRunForTask(sql, subject)) ??
    (await findLatestAutomationRunForTask(sql, subject));
  let workflowRun: TaskWorkflowRunState | null = null;
  if (automation !== null) {
    const live = LIVE_AUTOMATION_STATUSES.has(automation.status);
    const ask = live
      ? await getPendingAskForRun(sql, args.organizationId, automation.runId)
      : null;
    const detail = automation.detail ?? null;
    const waitingFor = runWaitingFor({
      status: automation.status,
      detail,
      askPending: ask !== null,
    });
    workflowRun = {
      runId: automation.runId,
      automation: automation.name,
      status: automation.status,
      live,
      ...(waitingFor !== undefined ? { waitingFor } : {}),
      ...(ask !== null
        ? {
            ask: {
              askId: ask.askId,
              createdAt: ask.createdAt,
              expiresAt: ask.expiresAt,
            },
          }
        : {}),
      ...(waitingFor === 'approval' && detail !== null
        ? { approvalId: detail.slice('approval:'.length) }
        : {}),
    };
  }
  const review = await getPendingReviewForTask(
    sql,
    args.organizationId,
    args.taskId,
  );
  return {
    agentRuns: runs.slice(0, args.runLimit),
    agentRunsHasMore: runs.length > args.runLimit,
    workflowRun,
    pendingReview:
      review === null
        ? null
        : {
            approvalId: review.approvalId,
            round: review.round,
            runId: review.runId,
            requestedFor: review.requestedFor,
            createdAt: review.createdAt,
          },
  };
}
