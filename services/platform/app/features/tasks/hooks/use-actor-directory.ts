import { useMemo } from 'react';

import { useProjectAgents } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import type { AgentDisplayCategory } from '../lib/agent-display';
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
}

// Shared frozen instances keep hook results referentially stable across
// renders when a context has no project (and thus no agents) to draw from.
const EMPTY_AGENT_LIST: AssignableAgent[] = [];
const EMPTY_CATALOG = new Map<string, { name: string; description?: string }>();

/**
 * Resolves task actors (comment authors, activity actors, assignees) — which
 * are stored polymorphically as a Better Auth `userId` or an agent id — to
 * human-readable display names, and exposes the assignable member/agent lists
 * for the assignee picker. Members come from the org directory; agents are
 * the PROJECT's user-created instances (`projectAgents` rows, from the
 * project Agents tab), so without a `projectId` no agent is assignable and a
 * historical/foreign agent actor resolves to its raw id. The retired
 * workflow catalog stays empty until automations grow a task-side directory.
 */
export function useActorDirectory(organizationId: string, projectId?: string) {
  const { members } = useMembers(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const { t } = useT('tasks');

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

  const { agents: projectAgents } = useProjectAgents(
    projectId !== undefined && projectId !== ''
      ? asProjectId(projectId)
      : undefined,
  );
  const agentList = useMemo<AssignableAgent[]>(
    () =>
      projectAgents.length === 0
        ? EMPTY_AGENT_LIST
        : projectAgents.map((row) => ({
            type: 'agent' as const,
            id: row._id,
            name: row.name,
            // Every instance runs on a coding harness in a sandbox.
            displayCategory: 'coding-agent' as const,
          })),
    [projectAgents],
  );
  const agentCatalog = useMemo(() => {
    if (projectAgents.length === 0) return EMPTY_CATALOG;
    const map = new Map<string, { name: string; description?: string }>();
    for (const row of projectAgents) map.set(row._id, { name: row.name });
    return map;
  }, [projectAgents]);
  const workflowCatalog = EMPTY_CATALOG;

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
 * project. Members outside the project's team(s) are dropped and disabled
 * members are always excluded; agents need no narrowing — the directory only
 * ever lists THIS project's instances. The unfiltered `members` / `agents` /
 * `resolveActor` are still returned (spread from the directory) for *display*
 * of historical/current actors.
 *
 * With no `projectId` members degrade to org-wide and agents to none — an
 * agent exists only inside its project. While the access query is in flight,
 * members fall back to org-wide; the backend guard is the real gate.
 */
export function useAssignableActors(
  organizationId: string,
  projectId?: Id<'projects'>,
) {
  const directory = useActorDirectory(organizationId, projectId);
  const { members } = directory;
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

  // Instances are project-curated by construction — the directory already
  // scoped them to this project, and the legacy agentMode roster restriction
  // never applies to them (its slugs cannot name an instance row).
  const assignableAgents = directory.agents;

  return { ...directory, assignableMembers, assignableAgents };
}
