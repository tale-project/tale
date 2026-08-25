'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

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
}

interface TaskBoardContextValue {
  /** True when the task has at least one unfinished blocker. */
  isBlocked: (taskId: string) => boolean;
  /** Resolve a task in the current board set (e.g. to label a parent). */
  getTask: (taskId: string) => TaskRow | undefined;
  /** True while an agent run on the task is live (working pulse). */
  isAgentWorking: (taskId: string) => boolean;
  /** True while the task's live run is parked on an unanswered `ask_human`
   * question — the card swaps the working pulse for the needs-answer chip. */
  isAgentAsking: (taskId: string) => boolean;
  /** True when the task waits at the review gate: it holds a pending
   * review approval, or sits at `in_review` with a designated reviewer
   * (pre-mint rows, workflow-lane parks). */
  needsReview: (taskId: string) => boolean;
  /** The reviewer the task's review waits on — the pending approval's
   * `requestedFor`, else the task's own designation while at `in_review`. */
  reviewRequestedFor: (taskId: string) => string | undefined;
}

const EMPTY: TaskBoardContextValue = {
  isBlocked: () => false,
  getTask: () => undefined,
  isAgentWorking: () => false,
  isAgentAsking: () => false,
  needsReview: () => false,
  reviewRequestedFor: () => undefined,
};

const TaskBoardContext = createContext(EMPTY);

/**
 * Provides board/list/table cards with the cross-task facts they can't read
 * off their own row: whether the task is blocked (derived from dependency edges
 * + the sibling status set), how to resolve another task by id (used to
 * label a subtask's parent), and the live-run / review-gate indicator state.
 * Keeps those lookups out of the per-card props so the DnD-cloned overlay
 * cards see the same data for free.
 */
export function TaskBoardProvider({
  tasks,
  dependencyEdges,
  runningTaskIds,
  askingTaskIds,
  pendingReviews,
  children,
}: {
  tasks: readonly TaskRow[];
  dependencyEdges: readonly DependencyEdge[];
  /** Tasks with a live agent run (from `getTaskOpsIndicators`). */
  runningTaskIds?: readonly string[];
  /** Tasks whose live run waits on an unanswered agent question (from
   * `getTaskOpsIndicators`; subset of `runningTaskIds`). */
  askingTaskIds?: readonly string[];
  /** Pending review-gate approvals (from `getTaskOpsIndicators`). */
  pendingReviews?: readonly PendingReviewRef[];
  children: ReactNode;
}) {
  const value = useMemo<TaskBoardContextValue>(() => {
    const byId = new Map<string, TaskRow>();
    for (const task of tasks) byId.set(task._id, task);
    const blocked = computeBlockedTaskIds(tasks, dependencyEdges);
    const working = new Set(runningTaskIds ?? []);
    const asking = new Set(askingTaskIds ?? []);
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
        task.reviewerUserId !== undefined
      );
    };
    return {
      isBlocked: (taskId) => blocked.has(taskId),
      getTask: (taskId) => byId.get(taskId),
      isAgentWorking: (taskId) => working.has(taskId),
      isAgentAsking: (taskId) => asking.has(taskId),
      needsReview: awaitsReview,
      reviewRequestedFor: (taskId) => {
        const pending = pendingByTask.get(taskId);
        if (pending?.requestedFor !== undefined) return pending.requestedFor;
        const task = byId.get(taskId);
        return task?.status === 'in_review' ? task.reviewerUserId : undefined;
      },
    };
  }, [tasks, dependencyEdges, runningTaskIds, askingTaskIds, pendingReviews]);

  return (
    <TaskBoardContext.Provider value={value}>
      {children}
    </TaskBoardContext.Provider>
  );
}

export function useTaskBoardContext(): TaskBoardContextValue {
  return useContext(TaskBoardContext);
}
