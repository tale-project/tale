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
}

const EMPTY: TaskBoardContextValue = {
  isBlocked: () => false,
  getTask: () => undefined,
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
  children,
}: {
  tasks: readonly TaskRow[];
  dependencyEdges: readonly DependencyEdge[];
  children: ReactNode;
}) {
  const value = useMemo<TaskBoardContextValue>(() => {
    const byId = new Map<string, TaskRow>();
    for (const task of tasks) byId.set(task._id, task);
    const blocked = computeBlockedTaskIds(tasks, dependencyEdges);
    return {
      isBlocked: (taskId) => blocked.has(taskId),
      getTask: (taskId) => byId.get(taskId),
    };
  }, [tasks, dependencyEdges]);

  return (
    <TaskBoardContext.Provider value={value}>
      {children}
    </TaskBoardContext.Provider>
  );
}

export function useTaskBoardContext(): TaskBoardContextValue {
  return useContext(TaskBoardContext);
}
