'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  agentHandleVariants,
  automationHandleVariants,
  memberHandleVariants,
} from '../lib/mention-handles';
import type {
  ActorDirectory,
  useAssignableActors,
} from './use-actor-directory';

export interface TaskActorScope {
  organizationId: string;
  projectId?: string;
}

export interface TaskMentionActor {
  name: string;
  kind: 'user' | 'agent' | 'automation';
}

interface ScopedDirectory extends TaskActorScope {
  directory: ActorDirectory | ReturnType<typeof useAssignableActors>;
  mentions: ReadonlyMap<string, TaskMentionActor>;
}

// Both the public actor hook API and task/assignment boundaries share this
// one context. Keeping its value independent of the loaders avoids a cycle.
const ActorDirectoryContext = createContext<ScopedDirectory | null>(null);

export function useProvidedActorScope(
  organizationId: string,
  projectId?: string,
) {
  const provided = useContext(ActorDirectoryContext);
  return provided !== null &&
    provided.organizationId === organizationId &&
    provided.projectId === projectId
    ? provided
    : undefined;
}

/** Matching nested providers read nothing. A different scope or an assignment
 * upgrade mounts its own unconditional loader child, sharing this value API. */
export function ActorDirectoryScopeProvider({
  organizationId,
  projectId,
  directory,
  requireAssignable = false,
  loader,
  children,
}: TaskActorScope & {
  directory?: ActorDirectory;
  requireAssignable?: boolean;
  loader: ReactNode;
  children?: ReactNode;
}) {
  const inherited = useProvidedActorScope(organizationId, projectId);
  if (
    inherited !== undefined &&
    (!requireAssignable || 'assignableMembers' in inherited.directory)
  ) {
    return children;
  }
  if (directory !== undefined) {
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
  return loader;
}

export function ActorDirectoryScopeValue({
  organizationId,
  projectId,
  directory,
  children,
}: TaskActorScope & {
  directory: ScopedDirectory['directory'];
  children?: ReactNode;
}) {
  const { members, agents, automations } = directory;
  const mentions = useMemo(() => {
    const map = new Map<string, TaskMentionActor>();
    // Match the server's collision order: agents have the strongest claim.
    for (const member of members ?? []) {
      for (const handle of memberHandleVariants(member)) {
        map.set(handle, { name: member.name, kind: 'user' });
      }
    }
    for (const automation of automations ?? []) {
      for (const handle of automationHandleVariants(automation)) {
        map.set(handle, { name: automation.name, kind: 'automation' });
      }
    }
    for (const agent of agents ?? []) {
      for (const handle of agentHandleVariants(agent)) {
        map.set(handle, { name: agent.name, kind: 'agent' });
      }
    }
    return map;
  }, [members, agents, automations]);
  const value = useMemo(
    () => ({ organizationId, projectId, directory, mentions }),
    [organizationId, projectId, directory, mentions],
  );
  return (
    <ActorDirectoryContext.Provider value={value}>
      {children}
    </ActorDirectoryContext.Provider>
  );
}
