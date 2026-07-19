import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useAgentInstallations,
  useListAgents,
} from '@/app/features/agents/hooks/queries';
import { toConfigurableAgent } from '@/app/features/agents/utils/agent-list-item';
import { useProject } from '@/app/features/projects/hooks/queries';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useListWorkflows } from '@/app/features/workflows/hooks/file-queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  getAgentDisplayCategory,
  getTaskDispatchHintKey,
  type AgentDisplayCategory,
  type TaskDispatchHintKey,
} from '@/lib/shared/agents/display-category';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import type { TaskActorType, TaskCreatorType } from '../lib/display';
import {
  buildAgentRunPreview,
  buildTaskActorPreview,
  buildWorkflowRunPreview,
  type TaskActivityContext,
  type TaskActorPreview,
} from '../utils/task-actor-preview';

export interface ResolvedActor {
  type: TaskCreatorType;
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
  /** Org role (members only) — lets the assignable filter drop disabled users. */
  role?: string;
}

export interface AssignableAgent extends AssignableActor {
  displayCategory: AgentDisplayCategory;
  taskDispatchHintKey: TaskDispatchHintKey | null;
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
  const installs = useAgentInstallations(organizationId);
  const { workflows: rawWorkflows } = useListWorkflows(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const { i18n } = useTranslation();
  const { t } = useT('tasks');
  const locale = i18n.language;

  const previewLabels = useMemo(
    () => ({
      unresolvedWorkflow: t('timeline.unresolvedWorkflow'),
    }),
    [t],
  );

  const memberList = useMemo<AssignableActor[]>(
    () =>
      (members ?? []).map((m) => ({
        type: 'user' as const,
        id: m.userId,
        name: m.displayName || m.email || m.userId,
        email: m.email,
        role: m.role,
      })),
    [members],
  );

  const enabledAgentSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const row of installs.data ?? []) {
      if (row.enabled) set.add(row.agentSlug);
    }
    return set;
  }, [installs.data]);

  const agentList = useMemo<AssignableAgent[]>(() => {
    if (installs.isLoading) return [];
    const list: AssignableAgent[] = [];
    for (const raw of rawAgents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      if (!enabledAgentSlugs.has(agent.name)) continue;
      const category = getAgentDisplayCategory(agent);
      if (category === 'image-agent') continue;
      const resolved = resolveAgentLocale(agent, locale);
      list.push({
        type: 'agent',
        id: agent.name,
        name: resolved.displayName || agent.name,
        displayCategory: category,
        taskDispatchHintKey: getTaskDispatchHintKey(agent),
      });
    }
    return list;
  }, [rawAgents, locale, enabledAgentSlugs, installs.isLoading]);

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

  const agentCatalog = useMemo(() => {
    const map = new Map<string, { name: string; description?: string }>();
    for (const raw of rawAgents ?? []) {
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      const resolved = resolveAgentLocale(agent, locale);
      map.set(agent.name, {
        name: resolved.displayName || agent.name,
        description: resolved.description ?? agent.description,
      });
    }
    return map;
  }, [rawAgents, locale]);

  const workflowCatalog = useMemo(() => {
    const map = new Map<string, { name: string; description?: string }>();
    for (const raw of rawWorkflows ?? []) {
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('slug' in raw) ||
        !('name' in raw)
      )
        continue;
      const slug = typeof raw.slug === 'string' ? raw.slug : undefined;
      const name = typeof raw.name === 'string' ? raw.name : undefined;
      if (!slug || !name) continue;
      map.set(slug, {
        name,
        description:
          typeof raw.description === 'string' ? raw.description : undefined,
      });
    }
    return map;
  }, [rawWorkflows]);

  const resolveActor = useMemo(
    () =>
      (type: TaskCreatorType, id: string): ResolvedActor => {
        if (type === 'app') {
          // App-provisioned (createdBy = app slug). No app directory in this
          // hook — show the slug; not an agent/member.
          return { type, id, name: id, isAgent: false };
        }
        if (type === 'agent') {
          if (id === 'system') {
            return {
              type,
              id,
              name: t('timeline.systemActor'),
              isAgent: true,
            };
          }
          // `agentMap` only holds LIVE (assignable) agents; a run-admission
          // refusal activity (#2609) names the agent that was asked to run,
          // which is by definition often not live (disabled/uninstalled). Fall
          // back to the unfiltered catalog so the timeline still shows a
          // friendly name instead of the raw slug for that common case.
          const agent = agentMap.get(id) ?? agentCatalog.get(id);
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
    [memberMap, agentMap, agentCatalog, t],
  );

  const resolveActorPreview = useMemo(
    () =>
      (
        actorType: 'user' | 'agent',
        actorId: string,
        context?: TaskActivityContext,
      ): TaskActorPreview | null =>
        buildTaskActorPreview({
          organizationId,
          actorType,
          actorId,
          context,
          agents: agentCatalog,
          workflows: workflowCatalog,
          labels: previewLabels,
        }),
    [organizationId, agentCatalog, workflowCatalog, previewLabels],
  );

  const resolveAgentRunPreview = useMemo(
    () =>
      (run: {
        agentSlug: string;
        workflowSlug?: string;
        wfExecutionId?: string;
      }): TaskActorPreview =>
        buildAgentRunPreview({
          organizationId,
          agentSlug: run.agentSlug,
          workflowSlug: run.workflowSlug,
          wfExecutionId: run.wfExecutionId,
          agents: agentCatalog,
          workflows: workflowCatalog,
          labels: previewLabels,
        }),
    [organizationId, agentCatalog, workflowCatalog, previewLabels],
  );

  const resolveWorkflowRunPreview = useMemo(
    () =>
      (run: {
        workflowSlug?: string;
        wfExecutionId?: string;
      }): TaskActorPreview | null =>
        buildWorkflowRunPreview({
          organizationId,
          workflowSlug: run.workflowSlug,
          wfExecutionId: run.wfExecutionId,
          workflows: workflowCatalog,
          labels: previewLabels,
        }),
    [organizationId, workflowCatalog, previewLabels],
  );

  return {
    resolveActor,
    resolveActorPreview,
    resolveAgentRunPreview,
    resolveWorkflowRunPreview,
    members: memberList,
    agents: agentList,
    currentUserId: me?.userId,
    // `useActorDirectory` stays org-wide — it also resolves *historical* actors
    // (comment authors, a current assignee who has since lost access), which a
    // project filter would regress to raw ids. The project-scoped candidate
    // lists for authoring live in `useAssignableActors` below.
    projectId,
  };
}

/**
 * The assignee picker and `@`-mention autocomplete build their candidate lists
 * from this: {@link useActorDirectory} narrowed to who can actually access the
 * project. Members outside the project's team(s) are dropped, agents the project
 * doesn't permit are dropped, and disabled members are always excluded. The
 * unfiltered `members` / `agents` / `resolveActor` are still returned (spread
 * from the directory) for *display* of historical/current actors.
 *
 * With no `projectId` the lists degrade to org-wide (all non-disabled members,
 * all agents) — there is no project to scope to. While the access query is in
 * flight, members fall back to org-wide; the backend guard is the real gate.
 */
export function useAssignableActors(
  organizationId: string,
  projectId?: Id<'projects'>,
) {
  const directory = useActorDirectory(organizationId, projectId);
  const { members, agents } = directory;
  const { project } = useProject(projectId);
  const scope = useConvexQuery(
    api.projects.queries.listAccessibleUserIds,
    projectId ? { organizationId, projectId } : 'skip',
  );

  const assignableMembers = useMemo<AssignableActor[]>(() => {
    const nonDisabled = members.filter((m) => m.role !== 'disabled');
    if (!projectId || !scope.data || scope.data.orgWide) return nonDisabled;
    const ids = new Set(scope.data.userIds);
    return nonDisabled.filter((m) => ids.has(m.id));
  }, [members, projectId, scope.data]);

  const assignableAgents = useMemo<AssignableAgent[]>(() => {
    if (project?.agentMode === 'restricted') {
      const allowed = new Set(project.allowedAgentSlugs ?? []);
      return agents.filter((a) => allowed.has(a.id));
    }
    // 'all' / unset: every agent, recommended ones first.
    const recommended = new Set(project?.recommendedAgentSlugs ?? []);
    return [...agents].sort(
      (a, b) => Number(recommended.has(b.id)) - Number(recommended.has(a.id)),
    );
  }, [agents, project]);

  return { ...directory, assignableMembers, assignableAgents };
}
