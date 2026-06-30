import { useMemo } from 'react';

import { useProject } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';

import { useActorDirectory } from '../hooks/use-actor-directory';
import { memberInsertHandle } from './mention-handles';

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
 * (`convex/tasks/directory.ts`). Agent scoping follows the workforce
 * semantics: the default `agentMode: 'all'` exposes every org agent
 * (recommended ones first); `'restricted'` limits the list to the project's
 * `allowedAgentSlugs`.
 *
 * Shared by the Tasks `MentionTextarea` and the Discussions composer's
 * `@`-mention source, so both pick from an identical, server-aligned list.
 */
export function useMentionActorOptions(
  organizationId: string,
  projectId: Id<'projects'>,
): MentionActorOption[] {
  const { members, agents, currentUserId } = useActorDirectory(
    organizationId,
    projectId,
  );
  const { project } = useProject(projectId);

  return useMemo(() => {
    const options: MentionActorOption[] = [];
    for (const member of members) {
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
    const restricted = project?.agentMode === 'restricted';
    const allowed = new Set(project?.allowedAgentSlugs ?? []);
    const recommended = new Set(project?.recommendedAgentSlugs ?? []);
    const mentionableAgents = restricted
      ? agents.filter((a) => allowed.has(a.id))
      : [...agents].sort(
          (a, b) =>
            Number(recommended.has(b.id)) - Number(recommended.has(a.id)),
        );
    for (const agent of mentionableAgents) {
      options.push({
        type: 'agent',
        id: agent.id,
        name: agent.name,
        handle: agent.id.toLowerCase(),
      });
    }
    return options;
  }, [members, agents, project, currentUserId]);
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
