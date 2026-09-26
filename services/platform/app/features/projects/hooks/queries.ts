import { useCallback } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';
import { backendKey } from '@/app/lib/backend/query-keys';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

/**
 * The shipped harnesses a project agent can run on — the same fixed set the
 * project Agents tab equips — and the models it can call. Reuses the
 * composer's org-scoped listing; chat itself never renders this roster (chat
 * is model selection only). The models are what the org's credentials serve,
 * so the listing keys under their entity: a provider added in settings
 * reaches every agent model picker without a reload.
 */
export function useProjectHarnesses(organizationId: string) {
  return useActionQuery(
    backendKey(organizationId, PROVIDER_CREDENTIAL_HINT_ENTITY, 'agent-roster'),
    'chat/composer:listComposerModels',
    { organizationId },
  );
}

/**
 * The skills + enabled connectors THIS PROJECT's agents can equip. Resolved
 * with the project's own visibility — org-wide skills plus team skills
 * shared with the project's teams — never with the configuring member's, so
 * an agent can only ever be equipped with what every project member's runs
 * may stage.
 */
export function useProjectCapabilityCatalog(
  organizationId: string,
  projectId: string | undefined,
) {
  return useActionQuery(
    ['projects', 'capability-catalog', organizationId, projectId ?? ''],
    'chat/composer:listProjectCapabilities',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `enabled` below skips the query while projectId is undefined
    { organizationId, projectId: projectId as string },
    { enabled: projectId !== undefined },
  );
}

/** The org's agent secrets (name + masked preview + description), for the
 * equipment picker and the secret manager. Values are never returned. */
export function useAgentSecrets(organizationId: string | undefined) {
  return useBackendQuery(
    'agent_secrets/queries:listAgentSecrets',
    organizationId !== undefined ? { organizationId } : 'skip',
  );
}

export type AgentSecretSummary =
  ItemOf<'agent_secrets/queries:listAgentSecrets'>;

export type ProjectListItem = ItemOf<'projects/queries:listProjects'>;

export type ProjectAgentRow = ItemOf<'projects/queries:listProjectAgents'>;

/** The project's user-created agents (name-sorted). */
export function useProjectAgents(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'projects/queries:listProjectAgents',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { agents: data ?? [], isLoading };
}

export type ProjectOverviewRow =
  ReturnsOf<'projects/queries:listProjectsOverview'>['projects'][number];

/**
 * How coarsely the overdue clock is quantized. `listProjectsOverview` derives
 * overdue from an `asOf` argument rather than `Date.now()` server-side,
 * because a Convex query result is only recomputed when a data dependency
 * changes — never because time passed. Rounding to a bucket gives the cache
 * key something that actually rotates, without refetching on every render.
 */
const OVERDUE_BUCKET_MS = 5 * 60 * 1000;

/**
 * The ONE place the overview query's args are built. The route loader
 * prefetches with these and the hook subscribes with these, so the TanStack
 * Query cache key cannot drift between the two — a mismatch would silently
 * turn the prefetch into a wasted request and paint a skeleton.
 */
export function projectsOverviewArgs(
  organizationId: string,
  includeArchived: boolean,
) {
  return {
    organizationId,
    includeArchived,
    asOf: Math.floor(Date.now() / OVERDUE_BUCKET_MS) * OVERDUE_BUCKET_MS,
  };
}

/**
 * The projects LIST page's data: every visible project plus its at-a-glance
 * rollups. Separate from `useProjects` — the plain list is on the chat hot
 * path and must not pay for these walks.
 */
export function useProjectsOverview(
  organizationId: string,
  options: { includeArchived: boolean },
) {
  const { data, isLoading, isError, error, refetch } = useBackendQuery(
    'projects/queries:listProjectsOverview',
    projectsOverviewArgs(organizationId, options.includeArchived),
  );
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    projects: data?.projects ?? [],
    // Global to the scan, so a truncated walk makes every row's overdue
    // number a lower bound.
    overdueTruncated: data?.overdueTruncated ?? false,
    isLoading,
    // A failed read is the list's to show, not to pass off as "no projects
    // yet" (2026-09-26 evaluation, G-07).
    error: isError ? error : null,
    retry,
  };
}

export function useProjects(
  organizationId: string,
  options?: { includeArchived?: boolean },
) {
  const { data, isLoading } = useBackendQuery('projects/queries:listProjects', {
    organizationId,
    includeArchived: options?.includeArchived,
  });
  return {
    projects: data ?? [],
    isLoading,
  };
}

export function useProject(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'projects/queries:getProject',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { project: data ?? null, isLoading };
}

export function useProjectDocuments(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'projects/queries:listProjectDocuments',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { documents: data ?? [], isLoading };
}

export function useProjectFolders(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'projects/queries:listProjectFolders',
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { folders: data ?? [], isLoading };
}

/** The Chats tab's data: the caller's own conversations in the project and
 * the ones other members shared with it, from the chat-v2 tables. */
export function useProjectChatThreads(projectId: string | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useBackendQuery(
    'chat/project_threads:listThreadsForProject',
    projectId && organizationId
      ? { organizationId, projectId: projectId }
      : 'skip',
  );
  return {
    mine: data?.mine ?? [],
    shared: data?.shared ?? [],
    isLoading,
  };
}
