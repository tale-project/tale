import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useAssignableActors } from '../hooks/use-actor-directory';
import { agentInsertHandle, memberInsertHandle } from './mention-handles';

export const MAX_MENTION_OPTIONS = 8;

export interface MentionActorOption {
  type: 'user' | 'agent';
  id: string;
  name: string;
  email?: string;
  /** The `@token` inserted into the text — picked to match a handle the
   *  server directory resolves (`convex/tasks/directory.ts::memberHandles`). */
  handle: string;
}

/**
 * Mentionable actors for a project, in picker order: org members first, then
 * agents — the same population the server resolves mentions against
 * (`convex/tasks/directory.ts`). Agent scoping follows the project agent
 * gates: the default `agentMode: 'all'` exposes every org agent
 * (recommended ones first); `'restricted'` limits the list to the project's
 * `allowedAgentSlugs`.
 *
 * Used by the Tasks `MentionTextarea` as its `@`-mention source, aligned
 * with the server's actor resolution.
 */
export function useMentionActorOptions(
  organizationId: string,
  projectId: Id<'projects'>,
): MentionActorOption[] {
  const { assignableMembers, assignableAgents, currentUserId } =
    useAssignableActors(organizationId, projectId);

  return useMemo(() => {
    const options: MentionActorOption[] = [];
    for (const member of assignableMembers) {
      // You never need to @mention yourself — leave the current user out.
      if (member.id === currentUserId) continue;
      const handle = memberInsertHandle(member);
      if (handle) {
        options.push({
          type: 'user',
          id: member.id,
          name: member.name,
          email: member.email,
          handle,
        });
      }
    }
    for (const agent of assignableAgents) {
      // Insert the readable name form — the raw instance id resolves too
      // (server keeps it as a fallback handle) but is noise in prose.
      const handle = agentInsertHandle(agent) ?? agent.id.toLowerCase();
      options.push({
        type: 'agent',
        id: agent.id,
        name: agent.name,
        handle,
      });
    }
    return options;
  }, [assignableMembers, assignableAgents, currentUserId]);
}

export function filterMentionActorOptions(
  options: MentionActorOption[],
  query: string,
): MentionActorOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, MAX_MENTION_OPTIONS);
  const matches = options.filter(
    (o) =>
      o.name.toLowerCase().includes(q) ||
      o.handle.includes(q) ||
      o.email?.toLowerCase().includes(q),
  );
  // Prefix matches (on the handle or name) read as "what I'm typing" — float
  // them above mere substring hits.
  const score = (o: MentionActorOption) =>
    o.handle.startsWith(q) || o.name.toLowerCase().startsWith(q) ? 0 : 1;
  return matches
    .sort((a, b) => score(a) - score(b))
    .slice(0, MAX_MENTION_OPTIONS);
}
