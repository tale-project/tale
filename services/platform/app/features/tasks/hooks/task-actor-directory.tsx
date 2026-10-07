'use client';

import type { ReactNode } from 'react';

import {
  TaskActorDirectoryProvider,
  TaskAssignableActorsProvider,
  useTaskActorDirectory,
  useTaskAssignableActors,
} from './task-actor-directory-context';

/** Re-export the scope provider under the name used by assignment controls. */
export const ActorDirectoryProvider = TaskActorDirectoryProvider;

export function useSharedActorDirectory(
  organizationId: string,
  projectId?: string,
) {
  return useTaskActorDirectory(organizationId, projectId);
}

export function useSharedAssignableActors(
  organizationId: string,
  projectId?: string,
) {
  return useTaskAssignableActors(organizationId, projectId);
}

/** Share one directory and its project access decision across a task surface. */
export function ActorDirectoryBoundary({
  organizationId,
  projectId,
  assignable = false,
  children,
}: {
  organizationId: string;
  projectId?: string;
  /** A board/task with editable controls shares candidate-access reads too. */
  assignable?: boolean;
  children: ReactNode;
}) {
  const Provider = assignable
    ? TaskAssignableActorsProvider
    : TaskActorDirectoryProvider;
  return (
    <Provider organizationId={organizationId} projectId={projectId}>
      {children}
    </Provider>
  );
}
