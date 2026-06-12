'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import {
  computeBlockedTaskIds,
  type DependencyEdge,
} from '../lib/dependencies';

type TaskRow = Doc<'tasks'>;

interface TaskBoardContextValue {
  /** True when the task has at least one unfinished blocker. */
  isBlocked: (taskId: string) => boolean;
  /** Resolve a task in the current board set (e.g. to label a parent). */
  getTask: (taskId: string) => TaskRow | undefined;
  /** True while an agent run on the task is live (working pulse). */
  isAgentWorking: (taskId: string) => boolean;
  /** True when the task has a pending review-gate approval. */
  needsReview: (taskId: string) => boolean;
}

const EMPTY: TaskBoardContextValue = {
  isBlocked: () => false,
  getTask: () => undefined,
  isAgentWorking: () => false,
  needsReview: () => false,
};

const TaskBoardContext = createContext(EMPTY);

/**
 * Provides board/list/table cards with the two cross-task facts they can't read
 * off their own row: whether the task is blocked (derived from dependency edges
 * + the sibling status set) and how to resolve another task by id (used to
 * label a subtask's parent). Keeps that lookup out of the per-card props so the
 * DnD-cloned overlay cards see the same data for free.
 */
export function TaskBoardProvider({
  tasks,
  dependencyEdges,
  runningTaskIds,
  reviewTaskIds,
  children,
}: {
  tasks: readonly TaskRow[];
  dependencyEdges: readonly DependencyEdge[];
  /** Tasks with a live agent run (from `getTaskOpsIndicators`). */
  runningTaskIds?: readonly string[];
  /** Tasks awaiting a review-gate decision. */
  reviewTaskIds?: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo<TaskBoardContextValue>(() => {
    const byId = new Map<string, TaskRow>();
    for (const task of tasks) byId.set(task._id, task);
    const blocked = computeBlockedTaskIds(tasks, dependencyEdges);
    const working = new Set(runningTaskIds ?? []);
    const review = new Set(reviewTaskIds ?? []);
    return {
      isBlocked: (taskId) => blocked.has(taskId),
      getTask: (taskId) => byId.get(taskId),
      isAgentWorking: (taskId) => working.has(taskId),
      needsReview: (taskId) => review.has(taskId),
    };
  }, [tasks, dependencyEdges, runningTaskIds, reviewTaskIds]);

  return (
    <TaskBoardContext.Provider value={value}>
      {children}
    </TaskBoardContext.Provider>
  );
}

export function useTaskBoardContext(): TaskBoardContextValue {
  return useContext(TaskBoardContext);
}
