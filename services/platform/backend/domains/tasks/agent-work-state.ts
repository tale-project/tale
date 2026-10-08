import type {
  AgentReviewBlockedReason,
  TaskAgentReviewReceipt,
  TaskDelegateReviewReceipt,
  TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';
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
import { readTaskReviewDecision } from './review-decision.ts';
import { readTaskReviewDelegation } from './review-delegation-receipt.ts';
import { getPendingReviewForTask } from './reviews.ts';

/**
 * What is working on a task, and who reviews it — the run half of an
 * agent's `task_get`, read with the readers the task sheet uses: its run
 * list, its automation banner and Run row, the ask card and the review gate.
 * Task-specific starts serialize on the task. Generic org-level admissions
 * can also carry its subject and may overlap; the reader selects the newest
 * matching live automation, without claiming those starts share that lock.
 *
 * The caller has scope-checked the task and passes its project: every read is
 * bound to the task and its org (a project automation must match the task's
 * project; an org-level run is already member-readable).
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
  /** Latest recorded native decision; a newer non-native or pending review hides it. */
  reviewDecision: TaskAgentReviewReceipt | null;
  /** Historical handoff into the latest gate; pendingReview is current ownership. */
  reviewDelegation: TaskDelegateReviewReceipt | null;
  /** Newest first — the first is the live run when the task has one. */
  agentRuns: TaskAgentRunSummary[];
  /** Whether older runs than this page exist. */
  agentRunsHasMore: boolean;
  /** The live automation run, else the latest one, else null. */
  workflowRun: TaskWorkflowRunState | null;
  /** Captured review ownership; agent verdicts use a separate opt-in tool. */
  pendingReview: {
    approvalId: string;
    round: number;
    runId: string | null;
    requestedFor: string | null;
    reviewer: TaskReviewRecipient | null;
    implementationAgentId: string | null;
    evidenceRevision: string | null;
    agentReviewBlockedReason: AgentReviewBlockedReason | null;
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
  // At least one run a page: an empty page that says more follow would give
  // the caller no position to continue from.
  const runLimit = Math.max(1, Math.floor(args.runLimit));
  const runs = await listTaskAgentRunSummaries(sql, {
    organizationId: args.organizationId,
    taskId: args.taskId,
    limit: runLimit + 1,
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
    agentRuns: runs.slice(0, runLimit),
    agentRunsHasMore: runs.length > runLimit,
    workflowRun,
    reviewDecision: await readTaskReviewDecision(sql, subject),
    reviewDelegation: await readTaskReviewDelegation(sql, subject),
    pendingReview:
      review === null
        ? null
        : {
            approvalId: review.approvalId,
            round: review.round,
            runId: review.runId,
            requestedFor: review.requestedFor,
            reviewer: review.reviewer,
            implementationAgentId: review.implementationAgentId,
            evidenceRevision: review.evidenceRevision,
            agentReviewBlockedReason: review.agentReviewBlockedReason,
            createdAt: review.createdAt,
          },
  };
}
