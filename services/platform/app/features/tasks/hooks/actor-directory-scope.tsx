'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  agentLegacyHandleVariants,
  agentMentionEntry,
  automationMentionEntry,
  buildMentionHandleIndex,
  type MentionHandleIndex,
  memberMentionEntry,
} from '@/lib/shared/mention-handles';

import type {
  ActorDirectory,
  useAssignableActors,
} from './use-actor-directory';

export interface TaskActorScope {
  organizationId: string;
  projectId?: string;
}

interface ScopedDirectory extends TaskActorScope {
  directory: ActorDirectory | ReturnType<typeof useAssignableActors>;
  /** Who a mention names: by kind and id for a stored mention, by handle
   * for a typed `@handle` (the server's own tiers). */
  mentions: MentionHandleIndex;
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
  // Listed as the server lists its directory (people, automations, agents),
  // so a handle two of them answer to names the one the server picked.
  const mentions = useMemo(
    () =>
      buildMentionHandleIndex([
        ...(members ?? []).map((member) =>
          memberMentionEntry({
            id: member.id,
            name: member.name,
            email: member.email,
          }),
        ),
        ...(automations ?? []).map((automation) =>
          automationMentionEntry(automation),
        ),
        ...(agents ?? []).map((agent) =>
          agentMentionEntry({
            id: agent.id,
            name: agent.name,
            handle: agent.handle ?? null,
            legacyHandles:
              agent.legacyHandles ?? agentLegacyHandleVariants(agent.name),
          }),
        ),
      ]),
    [members, agents, automations],
  );
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
