import { useMemo } from 'react';

import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

/**
 * The fixed third-party agents (sandbox harnesses) a project can equip.
 * Reuses the composer's org-scoped listing — the same fixed set chat offers.
 */
export function useProjectExternalAgents(organizationId: string) {
  return useActionQuery(
    ['projects', 'external-agents', organizationId],
    api.chat.composer.listComposerModels,
    { organizationId },
  );
}

/** The org's skills + enabled connectors a project can bind to an agent. */
export function useProjectCapabilityCatalog(organizationId: string) {
  return useActionQuery(
    ['projects', 'capability-catalog', organizationId],
    api.chat.composer.listComposerCapabilities,
    { organizationId },
  );
}

export type ProjectListItem = ConvexItemOf<
  typeof api.projects.queries.listProjects
>;

export function useProjects(
  organizationId: string,
  options?: { includeArchived?: boolean },
) {
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.listProjects,
    {
      organizationId,
      includeArchived: options?.includeArchived,
    },
  );
  return {
    projects: data ?? [],
    isLoading,
  };
}

export function useProject(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.getProject,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { project: data ?? null, isLoading };
}

export function useProjectStats(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.getProjectStats,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { stats: data ?? null, isLoading };
}

export function useProjectDocuments(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.listProjectDocuments,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { documents: data ?? [], isLoading };
}

export function useProjectFolders(projectId: Id<'projects'> | undefined) {
  const organizationId = useOrganizationId();
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.listProjectFolders,
    projectId && organizationId ? { projectId, organizationId } : 'skip',
  );
  return { folders: data ?? [], isLoading };
}

export function useProjectThreads(
  projectId: Id<'projects'> | undefined,
  scope: 'mine' | 'shared' | 'all' = 'all',
) {
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.listProjectThreads,
    projectId ? { projectId, scope } : 'skip',
  );
  return { threads: data ?? [], isLoading };
}

export function useSidebarProjects(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.listSidebarProjects,
    { organizationId, limit: 8 },
  );
  return { projects: data ?? [], isLoading };
}

export function useProjectsSearch(organizationId: string, query: string) {
  const { data, isLoading } = useConvexQuery(
    api.projects.queries.searchProjects,
    query.trim().length > 0
      ? { organizationId, query: query.trim(), limit: 20 }
      : 'skip',
  );
  return { results: data ?? [], isLoading };
}

/**
 * Partition project threads into "yours" / "shared with project" segments
 * client-side. Uses the `scope: 'all'` query for both segments at once.
 */
export function useProjectThreadSegments(
  projectId: Id<'projects'> | undefined,
  callerUserId: string | undefined,
) {
  const { threads, isLoading } = useProjectThreads(projectId, 'all');
  return useMemo(() => {
    if (!callerUserId) return { yours: [], shared: [], isLoading };
    const yours = threads.filter((t) => t.userId === callerUserId);
    const shared = threads.filter(
      (t) => t.userId !== callerUserId && t.sharedWithProject === true,
    );
    return { yours, shared, isLoading };
  }, [threads, callerUserId, isLoading]);
}
