'use client';

import type { TaskReviewRecipient } from '@tale/shared/schemas/task-review';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

import type {
  TaskOpsAutomationWaitIndicator,
  TaskOpsRunIndicator,
} from '@/app/lib/backend/contract/tasks';
import type { AgentRunWaitingReason } from '@/lib/shared/agent-run-waiting';

import {
  computeBlockedTaskIds,
  type DependencyEdge,
} from '../lib/dependencies';
import type { TaskDoc } from '../lib/display';

/** Board row — TaskDoc plus optional stamps from list queries. */
type TaskRow = TaskDoc & {
  projectKey?: string;
  folderExists?: boolean;
  hasFiles?: boolean;
};

/** A task's pending review-gate approval, as the ops indicators expose it. */
export interface PendingReviewRef {
  taskId: string;
  /** The named reviewer the request waits on; undefined when the review was
   * minted with no resolvable reviewer. */
  requestedFor: string | undefined;
  reviewer?: TaskReviewRecipient | null;
}

/** What the board knows of the task's live run — the one state its card and
 * list row say (`useTaskRunLine`). Absent: no live run is known. */
export type TaskRunState =
  /** The run waits on an unanswered question to a person. */
  | { kind: 'asking' }
  /** An agent works the task: its agent run runs, or its automation run's
   * agent turn does. */
  | { kind: 'working' }
  /** The agent run waits for room, with the reason its park kept. */
  | { kind: 'waiting'; reason?: AgentRunWaitingReason }
  /** The agent run, or the automation run, is queued and not parked. */
  | { kind: 'queued' }
  /** The automation run is parked on something other than its agent's turn
   * or a person's answer. */
  | {
      kind: 'automationWaiting';
      waitingFor?: TaskOpsAutomationWaitIndicator['waitingFor'];
    }
  /** The board's list of live runs is truncated and may hide this task's
   * run: never read it as idle. */
  | { kind: 'unknown' };

/** Whether the state may stand for a live run the task's moves act on. */
export function isRunLive(state: TaskRunState | undefined): boolean {
  return state !== undefined && state.kind !== 'unknown';
}

/** What a live run is doing, as the board's activity summary counts it: at
 * work, waiting on a person, or waiting for its turn or for room. */
export type RunActivity = 'running' | 'waitingForInput' | 'queued';

/** The activity a run state counts under; none for `unknown`, a run the
 * board cannot see, which is never counted. */
export function runActivity(state: TaskRunState): RunActivity | undefined {
  switch (state.kind) {
    case 'working':
      return 'running';
    case 'asking':
      return 'waitingForInput';
    case 'automationWaiting':
      // An approval or an in-doubt step waits on a person's decision.
      return state.waitingFor === 'approval' || state.waitingFor === 'in_doubt'
        ? 'waitingForInput'
        : 'queued';
    case 'waiting':
    case 'queued':
      return 'queued';
    case 'unknown':
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** One live run the ops indicators list: what the board's activity summary
 * counts, one entry per run, never per task or per agent. */
export interface LiveRun {
  taskId: string;
  /** The run, when the indicators name it: an agent run, or an automation
   * run that waits. A working automation run is known by its task alone. */
  runId?: string;
  /** The agent whose run it is, for an agent run. */
  agentId?: string;
  state: TaskRunState;
}

interface TaskBoardContextValue {
  /** True when the task has at least one unfinished blocker. */
  isBlocked: (taskId: string) => boolean;
  /** Resolve a task in the current board set (e.g. to label a parent). */
  getTask: (taskId: string) => TaskRow | undefined;
  /** What the task's live run does, the one reading of run state for every
   * card, row and summary. */
  runState: (taskId: string) => TaskRunState | undefined;
  /** True when the task waits at the review gate: it holds a pending
   * review approval, or sits at `in_review` with a designated reviewer
   * (pre-mint rows, workflow-lane parks). */
  needsReview: (taskId: string) => boolean;
  /** The reviewer the task's review waits on — the pending approval's
   * `requestedFor`, else the task's own designation while at `in_review`. */
  reviewRequestedFor: (taskId: string) => string | undefined;
  reviewRecipient: (taskId: string) => TaskReviewRecipient | undefined;
}

const EMPTY: TaskBoardContextValue = {
  isBlocked: () => false,
  getTask: () => undefined,
  runState: () => undefined,
  needsReview: () => false,
  reviewRequestedFor: () => undefined,
  reviewRecipient: () => undefined,
};

const TaskBoardContext = createContext(EMPTY);

/**
 * Provides board/list/table cards with the cross-task facts they can't read
 * off their own row: whether the task is blocked (derived from dependency edges
 * + the sibling status set), how to resolve another task by id (used to
 * label a subtask's parent), what the task's live run does (`runState`) and
 * the review-gate indicator state.
 * Keeps those lookups out of the per-card props so the DnD-cloned overlay
 * cards see the same data for free.
 */
export function TaskBoardProvider({
  tasks,
  dependencyEdges,
  runningTaskIds,
  askingTaskIds,
  runs,
  runsTruncated = false,
  automationWaits,
  pendingReviews,
  children,
}: {
  tasks: readonly TaskRow[];
  dependencyEdges: readonly DependencyEdge[];
  /** Tasks whose live run works (from `getTaskOpsIndicators`). */
  runningTaskIds?: readonly string[];
  /** Tasks whose live run waits on an unanswered agent question (from
   * `getTaskOpsIndicators`; subset of `runningTaskIds`). */
  askingTaskIds?: readonly string[];
  /** Live agent runs, running first (from `getTaskOpsIndicators`). */
  runs?: readonly TaskOpsRunIndicator[];
  /** More live agent runs exist than `runs` lists. */
  runsTruncated?: boolean;
  /** Tasks whose newest live automation run waits instead of working. */
  automationWaits?: readonly TaskOpsAutomationWaitIndicator[];
  /** Pending review-gate approvals (from `getTaskOpsIndicators`). */
  pendingReviews?: readonly PendingReviewRef[];
  children: ReactNode;
}) {
  const value = useMemo<TaskBoardContextValue>(() => {
    const byId = new Map<string, TaskRow>();
    for (const task of tasks) byId.set(task._id, task);
    const blocked = computeBlockedTaskIds(tasks, dependencyEdges);
    const runStates = readRunStates({
      runningTaskIds,
      askingTaskIds,
      runs,
      automationWaits,
    });
    const pendingByTask = new Map<string, PendingReviewRef>();
    for (const review of pendingReviews ?? []) {
      pendingByTask.set(review.taskId, review);
    }
    const awaitsReview = (taskId: string): boolean => {
      if (pendingByTask.has(taskId)) return true;
      const task = byId.get(taskId);
      return (
        task !== undefined &&
        task.status === 'in_review' &&
        (task.reviewerUserId !== undefined ||
          task.reviewerAgentId !== undefined)
      );
    };
    const reviewRecipient = (
      taskId: string,
    ): TaskReviewRecipient | undefined => {
      const pending = pendingByTask.get(taskId);
      if (pending !== undefined) {
        // A captured agent or unresolved recipient never becomes a person
        // because the task's future-review setting changed.
        if (pending.reviewer !== undefined)
          return pending.reviewer ?? undefined;
        return pending.requestedFor === undefined
          ? undefined
          : { kind: 'user', userId: pending.requestedFor };
      }
      const task = byId.get(taskId);
      if (task?.status !== 'in_review') return undefined;
      if (task.reviewerAgentId !== undefined)
        return { kind: 'agent', agentId: task.reviewerAgentId };
      return task.reviewerUserId === undefined
        ? undefined
        : { kind: 'user', userId: task.reviewerUserId };
    };
    return {
      isBlocked: (taskId) => blocked.has(taskId),
      getTask: (taskId) => byId.get(taskId),
      runState: (taskId) => {
        const known = runStates.get(taskId);
        if (known !== undefined || !runsTruncated) return known;
        // A truncated list lists every running run, then the oldest waiting
        // ones: a task it does not name may still have a queued run. An agent
        // run that a start, dispatch or a mention made puts its task In
        // progress, so that is where an unlisted run is looked for; a run
        // started in place (a standing role's) stays unseen there, as before.
        const task = byId.get(taskId);
        return task?.status === 'in_progress' && task.assigneeType === 'agent'
          ? { kind: 'unknown' }
          : undefined;
      },
      needsReview: awaitsReview,
      reviewRecipient,
      reviewRequestedFor: (taskId) => {
        const recipient = reviewRecipient(taskId);
        return recipient?.kind === 'user' ? recipient.userId : undefined;
      },
    };
  }, [
    tasks,
    dependencyEdges,
    runningTaskIds,
    askingTaskIds,
    runs,
    runsTruncated,
    automationWaits,
    pendingReviews,
  ]);

  return (
    <TaskBoardContext.Provider value={value}>
      {children}
    </TaskBoardContext.Provider>
  );
}

/** An agent run's state: at work, parked for room, or queued. */
function agentRunState(run: TaskOpsRunIndicator): TaskRunState {
  if (run.status === 'running') return { kind: 'working' };
  if (!run.waiting) return { kind: 'queued' };
  return {
    kind: 'waiting',
    ...(run.waitingReason !== undefined ? { reason: run.waitingReason } : {}),
  };
}

/** The state of an automation run that waits instead of working. */
function automationWaitState(
  wait: TaskOpsAutomationWaitIndicator,
): TaskRunState {
  if (wait.status === 'queued') return { kind: 'queued' };
  return {
    kind: 'automationWaiting',
    ...(wait.waitingFor !== undefined ? { waitingFor: wait.waitingFor } : {}),
  };
}

interface OpsRunLists {
  runningTaskIds?: readonly string[];
  askingTaskIds?: readonly string[];
  runs?: readonly TaskOpsRunIndicator[];
  automationWaits?: readonly TaskOpsAutomationWaitIndicator[];
}

/** Each task's live-run state from the ops indicators, the most telling
 * first: a question to a person, then work, then the agent run's wait, then
 * the automation run's. */
function readRunStates({
  runningTaskIds,
  askingTaskIds,
  runs,
  automationWaits,
}: OpsRunLists): Map<string, TaskRunState> {
  const states = new Map<string, TaskRunState>();
  const set = (taskId: string, state: TaskRunState) => {
    if (!states.has(taskId)) states.set(taskId, state);
  };
  for (const taskId of askingTaskIds ?? []) set(taskId, { kind: 'asking' });
  for (const taskId of runningTaskIds ?? []) set(taskId, { kind: 'working' });
  // Running runs come first, so a task's working run wins over its queued
  // one.
  for (const run of runs ?? []) set(run.taskId, agentRunState(run));
  for (const wait of automationWaits ?? []) {
    set(wait.taskId, automationWaitState(wait));
  }
  return states;
}

/** Every live run the ops indicators list, read with the same states as the
 * cards. A task can hold an agent run and an automation run at once, so a
 * task id in `runningTaskIds` is a run of its own unless it is the task's
 * listed working agent run or its automation run's question. */
export function readLiveRuns({
  runningTaskIds,
  askingTaskIds,
  runs,
  automationWaits,
}: OpsRunLists): LiveRun[] {
  const live: LiveRun[] = [];
  const agentWorking = new Set<string>();
  for (const run of runs ?? []) {
    const state = agentRunState(run);
    if (state.kind === 'working') agentWorking.add(run.taskId);
    live.push({
      taskId: run.taskId,
      runId: run.runId,
      agentId: run.agentId,
      state,
    });
  }
  const asking = new Set(askingTaskIds);
  for (const taskId of asking) live.push({ taskId, state: { kind: 'asking' } });
  for (const taskId of new Set(runningTaskIds)) {
    if (asking.has(taskId) || agentWorking.has(taskId)) continue;
    live.push({ taskId, state: { kind: 'working' } });
  }
  for (const wait of automationWaits ?? []) {
    live.push({
      taskId: wait.taskId,
      runId: wait.runId,
      state: automationWaitState(wait),
    });
  }
  return live;
}

export function useTaskBoardContext(): TaskBoardContextValue {
  return useContext(TaskBoardContext);
}
