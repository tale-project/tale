import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import { useAssignableActors } from '../hooks/use-actor-directory';
import {
  useTaskContractAutomations,
  taskSubjectEntries,
} from '../hooks/use-task-subject-contract';
import {
  agentInsertHandle,
  automationInsertHandle,
  memberInsertHandle,
} from './mention-handles';

export const MAX_MENTION_OPTIONS = 8;

export interface MentionActorOption {
  type: 'user' | 'agent' | 'automation';
  id: string;
  name: string;
  email?: string;
  /** The `@token` inserted into the text — picked to match a handle the
   *  server directory resolves (`convex/tasks/directory.ts::memberHandles`). */
  handle: string;
}

/**
 * Mentionable actors for a project, in picker order: org members first, then
 * agents, then the automations operating this board — the same population the
 * server resolves mentions against (`convex/tasks/directory.ts`). Agent
 * scoping follows the project agent gates: the default `agentMode: 'all'`
 * exposes every org agent (recommended ones first); `'restricted'` limits the
 * list to the project's `allowedAgentSlugs`. Automations are the deployed
 * subject-contract ones the assignee picker offers — @-ing a task's OWNING
 * automation puts it to work, exactly like @-ing an agent instance.
 *
 * Used by the Tasks `MentionTextarea` as its `@`-mention source, aligned
 * with the server's actor resolution.
 */
export function useMentionActorOptions(
  organizationId: string,
  projectId: string,
): MentionActorOption[] {
  const { assignableMembers, assignableAgents, currentUserId } =
    useAssignableActors(organizationId, projectId);
  const automations = useTaskContractAutomations(organizationId, projectId);
  const { locale } = useLocale();

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
    for (const entry of taskSubjectEntries(automations, locale)) {
      // Insert the store name — stable addressing the server always resolves,
      // identical for every reader whatever their locale.
      const handle = automationInsertHandle({
        slug: entry.automationSlug,
        name: entry.displayName,
      });
      if (handle) {
        options.push({
          type: 'automation',
          id: entry.automationSlug,
          name: entry.displayName,
          handle,
        });
      }
    }
    return options;
  }, [assignableMembers, assignableAgents, automations, currentUserId, locale]);
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
