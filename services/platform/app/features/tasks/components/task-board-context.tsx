'use client';

import type { TaskReviewRecipient } from '@tale/shared/schemas/task-review';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

import type { ResolvedActor } from '../hooks/use-actor-directory';
import type { ContractAutomationEntry } from '../hooks/use-task-subject-contract';
import {
  computeBlockedTaskIds,
  type DependencyEdge,
} from '../lib/dependencies';
import type { TaskCreatorType, TaskDoc } from '../lib/display';

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

/** What a card needs to name the people and agents on it — the slice of
 * {@link useActorDirectory} it reads. */
export interface TaskActorNames {
  resolveActor: (type: TaskCreatorType, id: string) => ResolvedActor;
  currentUserId: string | undefined;
}

/** The board's own actor directory, for the one project it was built for. */
export interface BoardActorDirectory extends TaskActorNames {
  projectId: string;
  /** The project's deployed automations, as the directory lists them —
   * what a card's automation badge resolves its owner among. */
  contractAutomations: ContractAutomationEntry[];
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
  reviewRecipient: (taskId: string) => TaskReviewRecipient | undefined;
  /** The board's actor directory, when it has one (a single project's
   * board); read through {@link useBoardActorDirectory}. */
  actors: BoardActorDirectory | undefined;
}

const EMPTY: TaskBoardContextValue = {
  isBlocked: () => false,
  getTask: () => undefined,
  isAgentWorking: () => false,
  isAgentAsking: () => false,
  needsReview: () => false,
  reviewRequestedFor: () => undefined,
  reviewRecipient: () => undefined,
  actors: undefined,
};

const TaskBoardContext = createContext(EMPTY);

/**
 * Provides board/list/table cards with the cross-task facts they can't read
 * off their own row: whether the task is blocked (derived from dependency edges
 * + the sibling status set), how to resolve another task by id (used to
 * label a subtask's parent), the live-run / review-gate indicator state, and
 * the board's actor directory, so a card names its assignee and reviewer
 * without reading a directory of its own (on a 2,000-card board those reads
 * cost seconds, #4062). Keeps those lookups out of the per-card props so the
 * DnD-cloned overlay cards see the same data for free.
 */
export function TaskBoardProvider({
  tasks,
  dependencyEdges,
  runningTaskIds,
  askingTaskIds,
  pendingReviews,
  actors,
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
  /** The board's `useActorDirectory(organizationId, projectId)`; absent where
   * the board spans projects (each card then reads its own project's). */
  actors?: BoardActorDirectory;
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
      isAgentWorking: (taskId) => working.has(taskId),
      isAgentAsking: (taskId) => asking.has(taskId),
      needsReview: awaitsReview,
      reviewRecipient,
      reviewRequestedFor: (taskId) => {
        const recipient = reviewRecipient(taskId);
        return recipient?.kind === 'user' ? recipient.userId : undefined;
      },
      actors,
    };
  }, [
    tasks,
    dependencyEdges,
    runningTaskIds,
    askingTaskIds,
    pendingReviews,
    actors,
  ]);

  return (
    <TaskBoardContext.Provider value={value}>
      {children}
    </TaskBoardContext.Provider>
  );
}

export function useTaskBoardContext(): TaskBoardContextValue {
  return useContext(TaskBoardContext);
}

/** The board's actor directory when it covers `projectId`; otherwise
 * undefined, and the caller reads a directory of its own. */
export function useBoardActorDirectory(
  projectId: string | undefined,
): BoardActorDirectory | undefined {
  const { actors } = useContext(TaskBoardContext);
  return projectId !== undefined && actors?.projectId === projectId
    ? actors
    : undefined;
}
