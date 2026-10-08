'use client';

import { memo, type ComponentType, type ReactNode } from 'react';

import {
  ActorDirectoryScopeProvider,
  ActorDirectoryScopeValue,
  useProvidedActorScope,
  type TaskActorScope,
} from './actor-directory-scope';
import { useActorDirectory, useAssignableActors } from './use-actor-directory';

/** Task bodies and standalone consumers share the same directory as the
 * upstream ActorDirectoryProvider API, including its scope and mention index. */
export function TaskActorDirectoryProvider({
  organizationId,
  projectId,
  directory,
  children,
}: TaskActorScope & {
  directory?: ReturnType<typeof useActorDirectory>;
  children: ReactNode;
}) {
  return (
    <ActorDirectoryScopeProvider
      organizationId={organizationId}
      projectId={projectId}
      directory={directory}
      loader={
        <LoadedTaskActorDirectoryProvider
          organizationId={organizationId}
          projectId={projectId}
        >
          {children}
        </LoadedTaskActorDirectoryProvider>
      }
    >
      {children}
    </ActorDirectoryScopeProvider>
  );
}

function LoadedTaskActorDirectoryProvider({
  organizationId,
  projectId,
  children,
}: TaskActorScope & { children: ReactNode }) {
  const directory = useActorDirectory(organizationId, projectId);
  return (
    <ActorDirectoryScopeValue
      organizationId={organizationId}
      projectId={projectId}
      directory={directory}
    >
      {children}
    </ActorDirectoryScopeValue>
  );
}

/** Boards with assignment controls share access reads and filtered candidates.
 * A matching raw scope upgrades once; display-only consumers reuse its value. */
export function TaskAssignableActorsProvider({
  organizationId,
  projectId,
  children,
}: TaskActorScope & { children: ReactNode }) {
  return (
    <ActorDirectoryScopeProvider
      organizationId={organizationId}
      projectId={projectId}
      requireAssignable
      loader={
        <LoadedTaskAssignableActorsProvider
          organizationId={organizationId}
          projectId={projectId}
        >
          {children}
        </LoadedTaskAssignableActorsProvider>
      }
    >
      {children}
    </ActorDirectoryScopeProvider>
  );
}

function LoadedTaskAssignableActorsProvider({
  organizationId,
  projectId,
  children,
}: TaskActorScope & { children: ReactNode }) {
  const directory = useAssignableActors(organizationId, projectId);
  return (
    <ActorDirectoryScopeValue
      organizationId={organizationId}
      projectId={projectId}
      directory={directory}
    >
      {children}
    </ActorDirectoryScopeValue>
  );
}

function useScopedDirectory(
  organizationId: string,
  projectId: string | undefined,
) {
  const scoped = useProvidedActorScope(organizationId, projectId);
  if (scoped === undefined) {
    throw new Error('Task actor directory requires a matching scope provider');
  }
  return scoped;
}

/** Read an existing scope without adding query observers per card/entry. */
export function useTaskActorDirectory(
  organizationId: string,
  projectId?: string,
) {
  return useScopedDirectory(organizationId, projectId).directory;
}

export function useTaskMentionActors(
  organizationId: string,
  projectId?: string,
) {
  return useScopedDirectory(organizationId, projectId).mentions;
}

export function useTaskAssignableActors(
  organizationId: string,
  projectId?: string,
) {
  const { directory } = useScopedDirectory(organizationId, projectId);
  if (!('assignableMembers' in directory)) {
    throw new Error('Task assignment requires an assignable actor provider');
  }
  return directory;
}

/** Standalone consumers load their own scope; nested consumers share the
 * enclosing one. Splitting the loader into its own component keeps hooks
 * unconditional when a matching provider appears or disappears. */
export function withTaskActorDirectory<Props extends TaskActorScope>(
  Component: ComponentType<Props>,
) {
  const Content = memo(Component);
  return memo(function TaskActorDirectoryBoundary(props: Props) {
    return (
      <TaskActorDirectoryProvider
        organizationId={props.organizationId}
        projectId={props.projectId}
      >
        <Content {...props} />
      </TaskActorDirectoryProvider>
    );
  });
}

export function withTaskAssignableActors<Props extends TaskActorScope>(
  Component: ComponentType<Props>,
) {
  const Content = memo(Component);
  return memo(function TaskAssignableActorsBoundary(props: Props) {
    return (
      <TaskAssignableActorsProvider
        organizationId={props.organizationId}
        projectId={props.projectId}
      >
        <Content {...props} />
      </TaskAssignableActorsProvider>
    );
  });
}
