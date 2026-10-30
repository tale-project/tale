import type { DispatchServingAgent } from '@tale/shared/schemas/project-dispatch';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { createElement, useMemo, type ReactNode } from 'react';

import {
  useProjectAgents,
  useStandardAgent,
} from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { projectAgentDetails } from '@/app/features/projects/lib/agent-details';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useT } from '@/lib/i18n/client';
import {
  automationDisplayName,
  titleFromSlug,
} from '@/lib/shared/schemas/automation_presentation';

import type { TaskActorType, TaskCreatorType } from '../lib/display';
import {
  buildAgentRunPreview,
  buildTaskActorPreview,
  buildWorkflowRunPreview,
  isDispatchSentinel,
  isWorkflowSentinel,
  type TaskActivityContext,
  type TaskActorPreview,
  type TaskActorCatalogEntry,
} from '../utils/task-actor-preview';
import {
  ActorDirectoryScopeProvider,
  ActorDirectoryScopeValue,
  useProvidedActorScope,
} from './actor-directory-scope';
import {
  useTaskContractAutomations,
  useTaskContractAutomationsPending,
} from './use-task-subject-contract';

/**
 * Where a person the member directory does not name stands: `pending` while
 * it has not answered (it is loading, or its read failed) — nobody is a
 * former member yet — and `former` once it has and they are not in it: a
 * member who left, or one whose account holds no name and no e-mail.
 */
export type ActorStanding = 'pending' | 'former';

export interface ResolvedActor {
  type: TaskCreatorType;
  id: string;
  /** Human-readable display name, never the raw id, which tells a reader
   * nothing: a person the directory does not name reads as a former member
   * once it has answered, and as `''` until then (see `standing`). */
  name: string;
  isAgent: boolean;
  /** Member email, when the actor is a resolved human. */
  email?: string;
  /** Set only for a person the directory does not name. */
  standing?: ActorStanding;
}

export interface AssignableActor {
  type: TaskActorType;
  id: string;
  name: string;
  email?: string;
  /** Org role (members only) — lets the assignable filter drop disabled users. */
  role?: string;
  /** Granted platform tools (agents only) — lets the reviewer picker grey an
   * agent the server would refuse for a missing `task_review` grant. */
  tools?: readonly string[];
  /** What a person types after `@` to mention it (agents only; absent from
   * an older backend). */
  handle?: string;
  /** What it answered to before agents had handles (agents only), so older
   * text that named it that way still shows it. */
  legacyHandles?: readonly string[];
  /** The organization's standard agent, set up in the project by Tale (agents
   * only): it takes a task only while it can run for the viewer. */
  managed?: boolean;
  /** An agent of another project whose dispatch serves this board (agents
   * only): it may be assigned and review here, but it is not this
   * project's to mention. Its project's name is null for a viewer who may
   * not read that project. */
  servedFrom?: { projectId: string; projectName: string | null };
}

// Shared frozen instances keep hook results referentially stable across
// renders when a context has no project (and thus no agents) to draw from.
const EMPTY_AGENT_LIST: AssignableActor[] = [];
const EMPTY_SERVING: readonly DispatchServingAgent[] = [];
const EMPTY_CATALOG = new Map<string, TaskActorCatalogEntry>();

/**
 * Resolves task actors (comment authors, activity actors, assignees) — which
 * are stored polymorphically as a Better Auth `userId` or an agent id — to
 * human-readable display names, and exposes the assignable member/agent lists
 * for the assignee picker. Members come from the org directory; agents are
 * the PROJECT's user-created instances (`projectAgents` rows, from the
 * project Agents tab), so without a `projectId` no agent is assignable and a
 * historical/foreign agent actor reads as a deleted agent. A person the
 * directory does not name reads as a former member once it has answered;
 * no actor is ever named by its raw id. The retired workflow catalog stays
 * empty until automations grow a task-side directory.
 */
export function useActorDirectory(organizationId: string, projectId?: string) {
  const { members } = useMembers(organizationId);
  const { data: me } = useCurrentMemberContext(organizationId);
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const formerMember = tCommon('formerMember');
  const { locale } = useLocale();
  // An `app` actor IS an automation — the assignee chip, the subtask avatars
  // and the timeline all named it by its slug before this, which is addressing
  // rather than a name.
  const automations = useTaskContractAutomations(
    organizationId,
    projectId === undefined ? undefined : asProjectId(projectId),
  );
  const automationsPending = useTaskContractAutomationsPending(
    organizationId,
    projectId === undefined ? undefined : asProjectId(projectId),
  );
  const appNames = useMemo(
    () =>
      new Map(
        automations.map((automation) => [
          automation.name,
          automationDisplayName(
            automation.presentation,
            automation.name,
            locale,
          ),
        ]),
      ),
    [automations, locale],
  );
  // The same population as a slug→display list, for the mention surfaces
  // (`@vat-return-desk` renders as the automation's name, mirroring agents).
  const automationList = useMemo(
    () => [...appNames.entries()].map(([slug, name]) => ({ slug, name })),
    [appNames],
  );

  const previewLabels = useMemo(
    () => ({
      unresolvedWorkflow: t('timeline.unresolvedWorkflow'),
      deletedAgent: t('timeline.deletedAgent'),
    }),
    [t],
  );

  const memberList = useMemo<AssignableActor[]>(
    () =>
      (members ?? []).map((m) => ({
        type: 'user' as const,
        id: m.userId,
        // An account that holds no name and no e-mail names nobody, as on
        // the automation pages; its id would tell a reader nothing either.
        name: m.displayName || m.email || formerMember,
        email: m.email,
        role: m.role,
      })),
    [members, formerMember],
  );

  const { agents: projectAgents, isLoading: ownAgentsLoading } =
    useProjectAgents(
      projectId !== undefined && projectId !== ''
        ? asProjectId(projectId)
        : undefined,
    );
  // The agents other projects' dispatches put to work on this board: they
  // are named here and may be assigned and review here, as the project's own.
  const serving = useBackendQuery(
    'projects/queries:listServingAgents',
    projectId !== undefined && projectId !== ''
      ? { organizationId, projectId }
      : 'skip',
  );
  const servingAgents = serving.data ?? EMPTY_SERVING;
  // An empty list is "no agent here" only once both reads settle: the
  // board's own agents and those serving it.
  const agentsLoading = ownAgentsLoading || serving.isLoading;
  const agentList = useMemo<AssignableActor[]>(() => {
    if (projectAgents.length === 0 && servingAgents.length === 0) {
      return EMPTY_AGENT_LIST;
    }
    const own = projectAgents.map((row) => ({
      type: 'agent' as const,
      id: row._id,
      name: row.name,
      tools: row.tools,
      ...(row.handle !== undefined ? { handle: row.handle } : {}),
      ...(row.legacyHandles !== undefined
        ? { legacyHandles: row.legacyHandles }
        : {}),
      ...(row.managed ? { managed: true } : {}),
    }));
    const ownIds = new Set(own.map((agent) => agent.id));
    return [
      ...own,
      ...servingAgents
        .filter((agent) => !ownIds.has(agent.agentId))
        .map((agent) => ({
          type: 'agent' as const,
          id: agent.agentId,
          name: agent.name,
          tools: agent.tools,
          servedFrom: {
            projectId: agent.projectId,
            projectName: agent.projectName,
          },
        })),
    ];
  }, [projectAgents, servingAgents]);
  const agentCatalog = useMemo(() => {
    if (projectAgents.length === 0 && servingAgents.length === 0) {
      return EMPTY_CATALOG;
    }
    const map = new Map<string, TaskActorCatalogEntry>();
    for (const agent of servingAgents) {
      map.set(agent.agentId, { name: agent.name });
    }
    for (const row of projectAgents) {
      const instructions = row.instructions?.trim();
      map.set(row._id, {
        name: row.name,
        agent: projectAgentDetails(row),
        ...(instructions !== undefined && instructions.length > 0
          ? { description: instructions }
          : {}),
      });
    }
    return map;
  }, [projectAgents, servingAgents]);
  const workflowCatalog = EMPTY_CATALOG;

  // The people the resolvers name: a listed member, by display name or else
  // e-mail. Anyone else is a former member once the directory has answered.
  const memberMap = useMemo(() => {
    const map = new Map<string, { name: string; email?: string }>();
    for (const m of members ?? []) {
      const name = m.displayName || m.email;
      if (name) map.set(m.userId, { name, email: m.email });
    }
    return map;
  }, [members]);

  const agentMap = useMemo(() => {
    const map = new Map<string, AssignableActor>();
    for (const a of agentList) map.set(a.id, a);
    return map;
  }, [agentList]);

  // An id none of the lists names may still be one of theirs until all of
  // them have answered.
  const directoryPending =
    members === undefined || agentsLoading || automationsPending;
  const resolveAssigneeId = useMemo(
    () =>
      (id: string): string => {
        const member = memberMap.get(id);
        if (member) return member.name;
        const agent = agentMap.get(id) ?? agentCatalog.get(id);
        if (agent) return agent.name;
        const appName = appNames.get(id);
        if (appName) return appName;
        // Named by nobody: a person who left the organization. The value
        // carries no type, so an agent deleted before it ever ran on the
        // task reads the same; one that ran is resolved as an agent by the
        // caller, which knows its runs.
        return directoryPending ? '' : formerMember;
      },
    [
      memberMap,
      agentMap,
      agentCatalog,
      appNames,
      directoryPending,
      formerMember,
    ],
  );

  const resolveActor = useMemo(
    () =>
      (type: TaskCreatorType, id: string): ResolvedActor => {
        if (type === 'app') {
          // An automation, addressed by its store name. Its declared name when
          // the listing knows it (deployed, visible from this project), the
          // slug read as a title otherwise — never the raw slug.
          return {
            type,
            id,
            name: appNames.get(id) ?? titleFromSlug(id),
            isAgent: false,
          };
        }
        if (type === 'agent') {
          if (isWorkflowSentinel(type, id)) {
            return {
              type,
              id,
              name: t('timeline.unresolvedWorkflow'),
              isAgent: true,
            };
          }
          if (id === 'system') {
            return {
              type,
              id,
              name: t('timeline.systemActor'),
              isAgent: true,
            };
          }
          // The project's dispatch assigned the task or moved it to work.
          if (isDispatchSentinel(type, id)) {
            return {
              type,
              id,
              name: t('timeline.dispatchActor'),
              isAgent: true,
            };
          }
          // `agentMap` only holds LIVE (assignable) agents; a run-admission
          // refusal activity (#2609) names the agent that was asked to run,
          // which is by definition often not live (disabled/uninstalled). Fall
          // back to the unfiltered catalog so the timeline still shows a
          // friendly name instead of the raw slug for that common case. An
          // agent in neither is gone (deleted from the project): its history
          // stays on the task, so say what it was rather than print its id.
          const agent = agentMap.get(id) ?? agentCatalog.get(id);
          return {
            type,
            id,
            name: agent?.name ?? t('timeline.deletedAgent'),
            isAgent: true,
          };
        }
        const member = memberMap.get(id);
        if (member !== undefined) {
          return {
            type,
            id,
            name: member.name,
            isAgent: false,
            email: member.email,
          };
        }
        // Someone the directory does not name: nobody yet while it has not
        // answered, then a former member — never the raw id.
        return members === undefined
          ? { type, id, name: '', isAgent: false, standing: 'pending' }
          : {
              type,
              id,
              name: formerMember,
              isAgent: false,
              standing: 'former',
            };
      },
    [appNames, memberMap, members, agentMap, agentCatalog, formerMember, t],
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

  const currentUserId = me?.userId;
  // One object per change, not per render: a provided directory is a context
  // value, and a fresh object would re-render every row that reads it.
  return useMemo(
    () => ({
      resolveActor,
      resolveAssigneeId,
      resolveActorPreview,
      resolveAgentRunPreview,
      resolveWorkflowRunPreview,
      members: memberList,
      agents: agentList,
      /** Deployed automations visible from this context, slug + display name. */
      automations: automationList,
      /** The same automations as listed, for the task-contract surfaces. */
      contractAutomations: automations,
      /** True while the project's agent list, or the agents other projects'
       * dispatches put on its board, are still being fetched — an empty
       * `agents` is only "this project HAS no agents" once this settles. */
      agentsLoading,
      /** True until the people, agents and automations a mention can name
       * have all arrived: a mention of someone not listed yet is not yet
       * someone gone. A mention names the project's own agents alone. */
      mentionsPending:
        members === undefined || ownAgentsLoading || automationsPending,
      currentUserId,
      organizationId,
      // `useActorDirectory` stays org-wide — it also resolves *historical* actors
      // (comment authors, a current assignee who has since lost access), which a
      // project filter would misname as former members. The project-scoped
      // candidate lists for authoring live in `useAssignableActors` below.
      projectId,
    }),
    [
      resolveActor,
      resolveAssigneeId,
      resolveActorPreview,
      resolveAgentRunPreview,
      resolveWorkflowRunPreview,
      memberList,
      agentList,
      automationList,
      automations,
      agentsLoading,
      ownAgentsLoading,
      members,
      automationsPending,
      currentUserId,
      organizationId,
      projectId,
    ],
  );
}

export type ActorDirectory = ReturnType<typeof useActorDirectory>;

/**
 * Reads ONE actor directory for everything below it. A row that names people
 * — a comment, a timeline entry, a card, each text run of a markdown body —
 * would otherwise read its own: five queries and a rebuilt member index per
 * row, which on a task with hundreds of comments or a board with thousands of
 * cards cost seconds to mount and to unmount. Rows take the provided directory
 * through {@link useProvidedActorDirectory}.
 */
export function ActorDirectoryProvider({
  organizationId,
  projectId,
  directory,
  children,
}: {
  organizationId: string;
  /** Absent where the surface spans projects: no agent resolves then, and
   * project-scoped rows read their own directory. */
  projectId?: string;
  /** Reuse a directory the owning task body has already read for its controls. */
  directory?: ActorDirectory;
  children: ReactNode;
}) {
  return createElement(
    ActorDirectoryScopeProvider,
    {
      organizationId,
      projectId,
      directory,
      loader: createElement(
        LoadedActorDirectoryProvider,
        { organizationId, projectId },
        children,
      ),
    },
    children,
  );
}

function LoadedActorDirectoryProvider({
  organizationId,
  projectId,
  children,
}: {
  organizationId: string;
  projectId?: string;
  children?: ReactNode;
}) {
  const directory = useActorDirectory(organizationId, projectId);
  return createElement(
    ActorDirectoryScopeValue,
    { organizationId, projectId, directory },
    children,
  );
}

/**
 * The directory an {@link ActorDirectoryProvider} above provides for this
 * organization and project — the same answer `useActorDirectory` would read
 * itself — or `undefined`, when there is none or it covers another project,
 * and the caller reads its own.
 */
export function useProvidedActorDirectory(
  organizationId: string,
  projectId?: string,
): ActorDirectory | undefined {
  return useProvidedActorScope(organizationId, projectId)?.directory;
}

/**
 * The assignee picker and `@`-mention autocomplete build their candidate lists
 * from this: {@link useActorDirectory} narrowed to who can actually access the
 * project. Members outside the project's team(s) are dropped and disabled
 * members are always excluded; agents are narrowed only by the standard
 * agent — the directory already lists only THIS project's instances, and the
 * one Tale set up there stays out while the standard agent cannot run for this
 * viewer. The unfiltered `members` / `agents` / `resolveActor` are still
 * returned (spread from the directory) for *display* of historical/current
 * actors.
 *
 * With no `projectId` members degrade to org-wide and agents to none — an
 * agent exists only inside its project. While the access query is in flight,
 * members fall back to org-wide; the backend guard is the real gate.
 * `scopeReady` says whether that narrowing has happened, for a picker that
 * must offer only who the server will take (the reviewer picker lists
 * nobody until it is true).
 *
 * `canAddAgents` says whether this viewer may add an agent to the project —
 * its editors may, everyone else reads its agents — so a picker can offer a
 * project without agents a way to make one, or say who can. It is false
 * until the project read has answered; `projectResolved` says it has, and
 * found the project.
 *
 * `standardAgentAvailable` says whether this viewer could hand a task to the
 * organization's standard agent now — the agent a project without its own
 * gets on first use. False while that read loads or when it failed.
 */
export function useAssignableActors(
  organizationId: string,
  projectId?: string,
) {
  const directory = useActorDirectory(organizationId, projectId);
  const { members } = directory;
  const scope = useBackendQuery(
    'projects/queries:listAccessibleUserIds',
    projectId ? { organizationId, projectId } : 'skip',
  );
  // The same read as the project page's, so it is usually already cached.
  const project = useBackendQuery(
    'projects/queries:getProject',
    projectId ? { organizationId, projectId } : 'skip',
  );

  const assignableMembers = useMemo<AssignableActor[]>(() => {
    const nonDisabled = members.filter((m) => m.role !== 'disabled');
    if (!projectId || !scope.data || scope.data.orgWide) return nonDisabled;
    const ids = new Set(scope.data.userIds);
    return nonDisabled.filter((m) => ids.has(m.id));
  }, [members, projectId, scope.data]);

  const standardAgentAvailable =
    useStandardAgent(projectId ? organizationId : undefined)?.available ===
    true;
  // Instances are project-curated by construction — the directory already
  // scoped them to this project. The standard agent Tale set up in the
  // project is one of them only while it can run for this viewer: a start
  // would be refused, so no list offers it as an agent that works.
  const assignableAgents = useMemo(
    () =>
      standardAgentAvailable
        ? directory.agents
        : directory.agents.filter((agent) => agent.managed !== true),
    [directory.agents, standardAgentAvailable],
  );
  const scopeReady = !projectId || scope.data !== undefined;
  const projectResolved = project.data != null;
  const canAddAgents = project.data?.canEdit === true;

  return useMemo(
    () => ({
      ...directory,
      assignableMembers,
      assignableAgents,
      scopeReady,
      projectResolved,
      canAddAgents,
      standardAgentAvailable,
    }),
    [
      directory,
      assignableMembers,
      assignableAgents,
      scopeReady,
      projectResolved,
      canAddAgents,
      standardAgentAvailable,
    ],
  );
}
