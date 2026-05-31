import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useListAgents } from '@/app/features/agents/hooks/queries';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import type { TaskActorType } from '../lib/display';

export interface ResolvedActor {
  type: TaskActorType;
  id: string;
  /** Human-readable display name. Falls back to the raw id when unresolved. */
  name: string;
  isAgent: boolean;
  /** Member email, when the actor is a resolved human. */
  email?: string;
}

export interface AssignableActor {
  type: TaskActorType;
  id: string;
  name: string;
  email?: string;
}

/**
 * Resolves task actors (comment authors, activity actors, assignees) — which
 * are stored polymorphically as a Better Auth `userId` or an agent slug — to
 * human-readable display names, and exposes the assignable member/agent lists
 * for the assignee picker. Members come from the org directory; agents from the
 * org's agent config files (locale-resolved). Both underlying queries are
 * deduped by their cache key, so calling this in multiple places is cheap.
 */
export function useActorDirectory(organizationId: string, projectId?: string) {
  const { members } = useMembers(organizationId);
  const { agents: rawAgents } = useListAgents(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const { i18n } = useTranslation();
  const locale = i18n.language;

  const memberList = useMemo<AssignableActor[]>(
    () =>
      (members ?? []).map((m) => ({
        type: 'user' as const,
        id: m.userId,
        name: m.displayName || m.email || m.userId,
        email: m.email,
      })),
    [members],
  );

  const agentList = useMemo<AssignableActor[]>(() => {
    const list: AssignableActor[] = [];
    for (const a of rawAgents ?? []) {
      if (!a || typeof a.name !== 'string' || 'status' in a) continue;
      const resolved = resolveAgentLocale(a, locale);
      list.push({
        type: 'agent',
        id: a.name,
        name: resolved.displayName || a.name,
      });
    }
    return list;
  }, [rawAgents, locale]);

  const memberMap = useMemo(() => {
    const map = new Map<string, AssignableActor>();
    for (const m of memberList) map.set(m.id, m);
    return map;
  }, [memberList]);

  const agentMap = useMemo(() => {
    const map = new Map<string, AssignableActor>();
    for (const a of agentList) map.set(a.id, a);
    return map;
  }, [agentList]);

  const resolveActor = useMemo(
    () =>
      (type: TaskActorType, id: string): ResolvedActor => {
        if (type === 'agent') {
          const agent = agentMap.get(id);
          return { type, id, name: agent?.name ?? id, isAgent: true };
        }
        const member = memberMap.get(id);
        return {
          type,
          id,
          name: member?.name ?? id,
          isAgent: false,
          email: member?.email,
        };
      },
    [memberMap, agentMap],
  );

  return {
    resolveActor,
    members: memberList,
    agents: agentList,
    currentUserId: me?.userId,
    // `projectId` is accepted for forward-compat (scoping agents to a project)
    // but the current directory is org-wide.
    projectId,
  };
}
