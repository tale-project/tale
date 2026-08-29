/**
 * Projects vertical over the 0.5 backend — the adapter rows the app-wide
 * Convex hook wrappers consult (`convex-adapters.ts`). Response types are
 * DERIVED from the 0.4 function signatures (`FunctionReturnType`), and every
 * pg wire row is projected to the 0.4 doc shape in exactly one place here
 * (`id` → `_id`, null → omitted-optional), so call sites keep compiling
 * against the shapes they always consumed.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { FunctionReturnType } from 'convex/server';

import type { api } from '@/convex/_generated/api';

import { BackendApiError, backendFetch } from './api-client';
import {
  invalidateChatThreads,
  moveChatThreadToProject,
  setChatThreadSharedWithProject,
  setProjectPinnedRequest,
} from './chat';
import type {
  AdaptedReadOptions,
  AdapterContext,
  ReadAdapter,
  ActionQueryAdapter,
  WriteAdapter,
} from './convex-adapters';
import { backendEntityPrefix, backendKey } from './query-keys';

// ---------------------------------------------------------------------------
// Wire rows (what the pg backend answers) + 0.4-shape projections
// ---------------------------------------------------------------------------

export type ProjectListItem = FunctionReturnType<
  typeof api.projects.queries.listProjects
>[number];
type ProjectOverviewResult = FunctionReturnType<
  typeof api.projects.queries.listProjectsOverview
>;
type ProjectAgentItem = FunctionReturnType<
  typeof api.projects.queries.listProjectAgents
>[number];
type SidebarProjectItem = FunctionReturnType<
  typeof api.projects.queries.listSidebarProjects
>[number];
type ProjectSearchItem = FunctionReturnType<
  typeof api.projects.queries.searchProjects
>[number];
type PaletteSearchItem = FunctionReturnType<
  typeof api.projects.search.searchProjects
>[number];
type ProjectThreadsResult = FunctionReturnType<
  typeof api.chat.project_threads.listThreadsForProject
>;
type AgentSecretItem = FunctionReturnType<
  typeof api.agent_secrets.queries.listAgentSecrets
>[number];
type ProjectSecretItem = FunctionReturnType<
  typeof api.projects.secrets.queries.listProjectSecrets
>[number];

/** One project as the backend returns it (access flags server-stamped). */
interface ProjectWire {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  key: string | null;
  externalItemId: string | null;
  taskCounter: number;
  openTaskCount: number;
  doneTaskCount: number;
  projectAgentCount: number;
  teamId: string | null;
  sharedWithTeamIds: string[];
  instructions: string | null;
  knowledgeMode: string | null;
  agentMode: string | null;
  recommendedAgentSlugs: string[];
  allowedAgentSlugs: string[];
  modelMode: string | null;
  recommendedModels: string[];
  allowedModels: string[];
  connectorsMode: string | null;
  allowedConnectorSlugs: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  pinnedAt: number | null;
  isOrgWide: boolean;
  canEdit: boolean;
  canAdminister: boolean;
}

function projectView(row: ProjectWire): ProjectListItem {
  const view: Record<string, unknown> = {
    _id: row.id,
    _creationTime: row.createdAt,
    organizationId: row.organizationId,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.icon !== null ? { icon: row.icon } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
    ...(row.key !== null ? { key: row.key } : {}),
    ...(row.externalItemId !== null
      ? { externalItemId: row.externalItemId }
      : {}),
    taskCounter: row.taskCounter,
    openTaskCount: row.openTaskCount,
    doneTaskCount: row.doneTaskCount,
    projectAgentCount: row.projectAgentCount,
    ...(row.teamId !== null ? { teamId: row.teamId } : {}),
    sharedWithTeamIds: row.sharedWithTeamIds,
    ...(row.instructions !== null ? { instructions: row.instructions } : {}),
    ...(row.knowledgeMode !== null ? { knowledgeMode: row.knowledgeMode } : {}),
    ...(row.agentMode !== null ? { agentMode: row.agentMode } : {}),
    recommendedAgentSlugs: row.recommendedAgentSlugs,
    allowedAgentSlugs: row.allowedAgentSlugs,
    ...(row.modelMode !== null ? { modelMode: row.modelMode } : {}),
    recommendedModels: row.recommendedModels,
    allowedModels: row.allowedModels,
    ...(row.connectorsMode !== null
      ? { connectorsMode: row.connectorsMode }
      : {}),
    allowedConnectorSlugs: row.allowedConnectorSlugs,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.archivedAt !== null ? { archivedAt: row.archivedAt } : {}),
    ...(row.pinnedAt !== null ? { pinnedAt: row.pinnedAt } : {}),
    isOrgWide: row.isOrgWide,
    canEdit: row.canEdit,
    canAdminister: row.canAdminister,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as ProjectListItem;
}

interface ProjectAgentWire {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  harness: string;
  model: string;
  modelProvider: string | null;
  skills: string[];
  connectors: string[];
  tools: string[];
  secrets: string[];
  instructions: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

function projectAgentView(row: ProjectAgentWire): ProjectAgentItem {
  const view: Record<string, unknown> = {
    _id: row.id,
    _creationTime: row.createdAt,
    organizationId: row.organizationId,
    projectId: row.projectId,
    name: row.name,
    harness: row.harness,
    model: row.model,
    ...(row.modelProvider !== null ? { modelProvider: row.modelProvider } : {}),
    skills: row.skills,
    connectors: row.connectors,
    tools: row.tools,
    secrets: row.secrets,
    ...(row.instructions !== null ? { instructions: row.instructions } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as ProjectAgentItem;
}

function sidebarProjectView(row: ProjectWire): SidebarProjectItem {
  const view: Record<string, unknown> = {
    _id: row.id,
    name: row.name,
    ...(row.icon !== null ? { icon: row.icon } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
    updatedAt: row.updatedAt,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as SidebarProjectItem;
}

function searchProjectView(row: ProjectWire): ProjectSearchItem {
  const view: Record<string, unknown> = {
    _id: row.id,
    name: row.name,
    ...(row.icon !== null ? { icon: row.icon } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as ProjectSearchItem;
}

/** The 0.4 palette snippet, verbatim (`key · description`, capped). */
const SNIPPET_MAX_CHARS = 600;
function paletteHitView(row: ProjectWire): PaletteSearchItem {
  const parts: string[] = [];
  if (row.key !== null && row.key.length > 0) parts.push(row.key);
  if (row.description !== null && row.description.trim().length > 0) {
    parts.push(row.description.trim());
  }
  const text = parts.join(' · ');
  const snippet =
    text.length <= SNIPPET_MAX_CHARS
      ? text
      : `${text.slice(0, SNIPPET_MAX_CHARS - 1)}…`;
  const view: Record<string, unknown> = {
    projectId: row.id,
    name: row.name,
    ...(row.key !== null ? { key: row.key } : {}),
    snippet,
    updatedAt: row.updatedAt,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as PaletteSearchItem;
}

interface ProjectThreadWire {
  id: string;
  title: string | null;
  updatedAt: number;
  sharedWithProject: boolean | null;
  userId: string;
  authorName: string | null;
}

function projectThreadView(
  row: ProjectThreadWire,
): ProjectThreadsResult['mine'][number] {
  const view: Record<string, unknown> = {
    id: row.id,
    ...(row.title !== null ? { title: row.title } : {}),
    updatedAt: row.updatedAt,
    ...(row.sharedWithProject !== null
      ? { sharedWithProject: row.sharedWithProject }
      : {}),
    userId: row.userId,
    authorName: row.authorName,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
  return view as ProjectThreadsResult['mine'][number];
}

// ---------------------------------------------------------------------------
// Read adapters
// ---------------------------------------------------------------------------

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

/**
 * The projects LIST page's read, exported for the route loader's prefetch —
 * the ONE options builder both the loader and the hook's adapter row share,
 * so their cache keys cannot drift.
 */
export function projectsOverviewQuery(args: {
  organizationId: string;
  includeArchived?: boolean;
  asOf?: number;
}): AdaptedReadOptions {
  const { organizationId } = args;
  const includeArchived = args.includeArchived === true;
  const asOf = args.asOf ?? 0;
  const params = new URLSearchParams({
    includeArchived: String(includeArchived),
    ...(asOf > 0 ? { asOf: String(asOf) } : {}),
  });
  return {
    queryKey: backendKey(
      organizationId,
      'project',
      'overview',
      includeArchived,
      asOf,
    ),
    queryFn: () =>
      backendFetch<{
        projects: (ProjectWire & { overdueTaskCount: number })[];
        overdueTruncated: boolean;
      }>(`/projects/overview?${params.toString()}`, {
        orgId: organizationId,
      }).then((body): ProjectOverviewResult => ({
        // The overview shape re-stamps the rollups as REQUIRED numbers
        // (the 0.4 handler's `?? 0`), on top of the list-item projection.
        projects: body.projects.map((row) =>
          Object.assign(projectView(row), {
            openTaskCount: row.openTaskCount,
            doneTaskCount: row.doneTaskCount,
            projectAgentCount: row.projectAgentCount,
            overdueTaskCount: row.overdueTaskCount,
          }),
        ),
        overdueTruncated: body.overdueTruncated,
      })),
  };
}

export const projectReadAdapters: Record<string, ReadAdapter> = {
  'projects/queries:listProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    const includeArchived = args.includeArchived === true;
    return {
      queryKey: backendKey(orgId, 'project', 'list', includeArchived),
      queryFn: () =>
        backendFetch<{ projects: ProjectWire[] }>(
          `/projects?includeArchived=${includeArchived}`,
          { orgId },
        ).then((body): ProjectListItem[] => body.projects.map(projectView)),
    };
  },
  'projects/queries:listProjectsOverview': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return projectsOverviewQuery({
      organizationId: orgId,
      includeArchived: args.includeArchived === true,
      ...(typeof args.asOf === 'number' ? { asOf: args.asOf } : {}),
    });
  },
  'projects/queries:getProject': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'project', 'detail', projectId),
      queryFn: () =>
        backendFetch<{ project: ProjectWire }>(
          `/projects/${encodeURIComponent(projectId)}`,
          { orgId },
        ).then(
          (body): ProjectListItem | null => projectView(body.project),
          (error: unknown): ProjectListItem | null => {
            // 0.4 answers null for missing / cross-org / inaccessible —
            // never an error state.
            if (
              error instanceof BackendApiError &&
              (error.status === 404 || error.status === 403)
            ) {
              return null;
            }
            throw error;
          },
        ),
    };
  },
  'projects/queries:listProjectAgents': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'project', 'agents', projectId),
      queryFn: () =>
        backendFetch<{ agents: ProjectAgentWire[] }>(
          `/projects/${encodeURIComponent(projectId)}/agents`,
          { orgId },
        ).then((body): ProjectAgentItem[] => body.agents.map(projectAgentView)),
    };
  },
  'projects/queries:listSidebarProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'project', 'sidebar'),
      queryFn: () =>
        backendFetch<{ projects: ProjectWire[] }>('/projects/sidebar', {
          orgId,
        }).then((body): SidebarProjectItem[] =>
          body.projects.map(sidebarProjectView),
        ),
    };
  },
  'projects/queries:searchProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const query = typeof args.query === 'string' ? args.query : '';
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'project', 'search', query),
      queryFn: () =>
        backendFetch<{ projects: ProjectWire[] }>(
          `/projects/search?q=${encodeURIComponent(query)}`,
          { orgId },
        ).then((body): ProjectSearchItem[] =>
          body.projects.map(searchProjectView),
        ),
    };
  },
  'projects/search:searchProjects': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const query = typeof args.query === 'string' ? args.query : '';
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'project', 'palette-search', query),
      queryFn: () =>
        backendFetch<{ projects: ProjectWire[] }>(
          `/projects/search?q=${encodeURIComponent(query)}`,
          { orgId },
        ).then((body): PaletteSearchItem[] =>
          body.projects.map(paletteHitView),
        ),
    };
  },
  'chat/project_threads:listThreadsForProject': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'chat_thread', 'project-threads', projectId),
      queryFn: () =>
        backendFetch<{
          mine: ProjectThreadWire[];
          shared: ProjectThreadWire[];
        }>(`/chat/project/${encodeURIComponent(projectId)}/threads`, {
          orgId,
        }).then((body): ProjectThreadsResult => ({
          mine: body.mine.map(projectThreadView),
          shared: body.shared.map(projectThreadView),
        })),
    };
  },
  'agent_secrets/queries:listAgentSecrets': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return {
      queryKey: backendKey(orgId, 'agent_secret', 'list'),
      queryFn: () =>
        backendFetch<{ secrets: AgentSecretItem[] }>('/agent-secrets', {
          orgId,
        }).then((body) => body.secrets),
    };
  },
  'projects/queries:listAccessibleUserIds': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'project', 'accessible-users', projectId),
      queryFn: () =>
        backendFetch<{ orgWide: boolean; userIds: string[] }>(
          `/projects/${encodeURIComponent(projectId)}/accessible-users`,
          { orgId },
        ),
    };
  },
  'projects/secrets/queries:listProjectSecrets': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return {
      queryKey: backendKey(orgId, 'project', 'project-secrets', projectId),
      queryFn: () =>
        backendFetch<{
          secrets: {
            name: string;
            description: string | null;
            updatedAt: number;
            updatedBy: string;
          }[];
        }>(`/projects/${encodeURIComponent(projectId)}/secrets`, {
          orgId,
        }).then((body): ProjectSecretItem[] =>
          body.secrets.map((row) => {
            const view: Record<string, unknown> = {
              name: row.name,
              ...(row.description !== null
                ? { description: row.description }
                : {}),
              updatedAt: row.updatedAt,
              updatedBy: row.updatedBy,
            };
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the one fetch-boundary projection to the 0.4 shape
            return view as ProjectSecretItem;
          }),
        ),
    };
  },
};

// ---------------------------------------------------------------------------
// Action-query adapters (the composer's org-config walks)
// ---------------------------------------------------------------------------

/** The two "currently serving" preview walks share one URL shape. */
function servingPreviewFetch(
  domain: 'automations' | 'tasks',
  args: Record<string, unknown>,
  ctx: AdapterContext,
): (() => Promise<unknown>) | null {
  const orgId = orgOf(args, ctx);
  const model = typeof args.model === 'string' ? args.model : '';
  const harness = typeof args.harness === 'string' ? args.harness : '';
  if (orgId === undefined || model.length === 0 || harness.length === 0) {
    return null;
  }
  const params = new URLSearchParams({ model, harness });
  return () =>
    backendFetch(`/${domain}/serving-preview?${params.toString()}`, { orgId });
}

export const projectActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'chat/composer:listComposerModels': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () => backendFetch('/chat/composer/models', { orgId });
  },
  'chat/composer:listProjectCapabilities': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const projectId = args.projectId;
    if (orgId === undefined || typeof projectId !== 'string') return null;
    return () =>
      backendFetch(
        `/chat/composer/project/${encodeURIComponent(projectId)}/capabilities`,
        { orgId },
      );
  },
  'automations/serving_preview:previewUnpinnedAgentServing': (args, ctx) =>
    servingPreviewFetch('automations', args, ctx),
  'tasks/serving_preview:previewUnpinnedTaskServing': (args, ctx) =>
    servingPreviewFetch('tasks', args, ctx),
};

// ---------------------------------------------------------------------------
// Write adapters
// ---------------------------------------------------------------------------

function invalidateProjects(client: QueryClient, orgId: string): void {
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'project'),
  });
}

function invalidateAgentSecrets(client: QueryClient, orgId: string): void {
  void client.invalidateQueries({
    queryKey: backendEntityPrefix(orgId, 'agent_secret'),
  });
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for this write');
  }
  return orgId;
}

function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${field}`);
  }
  return value;
}

/** POST an update verb under `/projects/:id/<verb>`, body = args minus ids. */
function projectVerb(
  verb: string,
): (args: Record<string, unknown>, ctx: AdapterContext) => Promise<unknown> {
  return async (args, ctx) => {
    const orgId = requireOrg(args, ctx);
    const projectId = requireString(args, 'projectId');
    const { organizationId: _org, projectId: _project, ...body } = args;
    await backendFetch(`/projects/${encodeURIComponent(projectId)}/${verb}`, {
      method: 'POST',
      body,
      orgId,
    });
    return null;
  };
}

const projectWriteInvalidate = (
  client: QueryClient,
  args: Record<string, unknown>,
  ctx: AdapterContext,
): void => {
  const orgId = orgOf(args, ctx);
  if (orgId !== undefined) invalidateProjects(client, orgId);
};

export const projectWriteAdapters: Record<string, WriteAdapter> = {
  'projects/mutations:createProject': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const { organizationId: _org, ...body } = args;
      const created = await backendFetch<{ projectId: string }>('/projects', {
        method: 'POST',
        body,
        orgId,
      });
      return created.projectId;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectIdentity': {
    run: projectVerb('identity'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectInstructions': {
    run: projectVerb('instructions'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectSharing': {
    run: projectVerb('sharing'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectKnowledgeMode': {
    run: projectVerb('knowledge-mode'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectAgentSettings': {
    run: projectVerb('agent-settings'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectModelSettings': {
    run: projectVerb('model-settings'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectConnectorSettings': {
    run: projectVerb('connector-settings'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:setProjectPinned': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      await setProjectPinnedRequest(
        orgId,
        requireString(args, 'projectId'),
        args.pinned === true,
      );
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:archiveProject': {
    run: projectVerb('archive'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:restoreProject': {
    run: projectVerb('restore'),
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:duplicateProject': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      const created = await backendFetch<{ projectId: string }>(
        `/projects/${encodeURIComponent(projectId)}/duplicate`,
        {
          method: 'POST',
          body: typeof args.name === 'string' ? { name: args.name } : {},
          orgId,
        },
      );
      return created.projectId;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:deleteProject': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      return backendFetch(`/projects/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        body: {
          mode: args.mode,
          ...(typeof args.confirmPhrase === 'string'
            ? { confirmPhrase: args.confirmPhrase }
            : {}),
        },
        orgId,
      });
    },
    invalidate: (client, args, ctx) => {
      projectWriteInvalidate(client, args, ctx);
      const orgId = orgOf(args, ctx);
      // Detached/trashed conversations move under the same delete.
      if (orgId !== undefined) invalidateChatThreads(client, orgId);
    },
  },
  'projects/mutations:createProjectAgent': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      const { projectId: _project, ...body } = args;
      const created = await backendFetch<{ agentId: string }>(
        `/projects/${encodeURIComponent(projectId)}/agents`,
        { method: 'POST', body, orgId },
      );
      return created.agentId;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:updateProjectAgent': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const agentId = requireString(args, 'agentId');
      const { agentId: _agent, ...body } = args;
      await backendFetch(`/projects/agents/${encodeURIComponent(agentId)}`, {
        method: 'POST',
        body,
        orgId,
      });
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:deleteProjectAgent': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const agentId = requireString(args, 'agentId');
      await backendFetch(`/projects/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        orgId,
      });
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/mutations:moveThreadToProject': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = args.projectId;
      await moveChatThreadToProject(
        orgId,
        requireString(args, 'threadId'),
        typeof projectId === 'string' ? projectId : null,
      );
      return null;
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      invalidateChatThreads(client, orgId);
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'chat_thread'),
      });
      invalidateProjects(client, orgId);
    },
  },
  'chat/threads:setThreadSharedWithProject': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return setChatThreadSharedWithProject(
        orgId,
        requireString(args, 'threadId'),
        args.shared === true,
      );
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId === undefined) return;
      void client.invalidateQueries({
        queryKey: backendEntityPrefix(orgId, 'chat_thread'),
      });
    },
  },
  'agent_secrets/actions:upsertAgentSecret': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      return backendFetch<{ created: boolean }>('/agent-secrets', {
        method: 'POST',
        body: {
          name: args.name,
          value: args.value,
          ...(typeof args.description === 'string'
            ? { description: args.description }
            : {}),
        },
        orgId,
      });
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId !== undefined) invalidateAgentSecrets(client, orgId);
    },
  },
  'agent_secrets/mutations:deleteAgentSecret': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      await backendFetch(
        `/agent-secrets/${encodeURIComponent(requireString(args, 'name'))}`,
        { method: 'DELETE', orgId },
      );
      return null;
    },
    invalidate: (client, args, ctx) => {
      const orgId = orgOf(args, ctx);
      if (orgId !== undefined) invalidateAgentSecrets(client, orgId);
    },
  },
  'projects/secrets/actions:setProjectSecret': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      await backendFetch(`/projects/${encodeURIComponent(projectId)}/secrets`, {
        method: 'POST',
        body: {
          name: args.name,
          value: args.value,
          ...(typeof args.description === 'string'
            ? { description: args.description }
            : {}),
        },
        orgId,
      });
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/secrets/actions:setProjectSecretPair': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      await backendFetch(
        `/projects/${encodeURIComponent(projectId)}/secrets/pair`,
        {
          method: 'POST',
          body: {
            baseName: args.baseName,
            username: args.username,
            password: args.password,
            ...(typeof args.description === 'string'
              ? { description: args.description }
              : {}),
          },
          orgId,
        },
      );
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
  'projects/secrets/actions:deleteProjectSecret': {
    run: async (args, ctx) => {
      const orgId = requireOrg(args, ctx);
      const projectId = requireString(args, 'projectId');
      await backendFetch(
        `/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(requireString(args, 'name'))}`,
        { method: 'DELETE', orgId },
      );
      return null;
    },
    invalidate: projectWriteInvalidate,
  },
};
