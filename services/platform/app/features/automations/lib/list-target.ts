import { automationSlugToParam } from '@/lib/automations/slug';

/**
 * The project shell a row opens in, if any: the listing's own project on a
 * project tab, else the sole binding of a single-bound automation. Org-level
 * and multi-bound ones have no one project to route into and stay on the org
 * detail.
 */
export function automationTargetProjectId({
  listProjectId,
  boundProjectIds,
}: {
  listProjectId?: string;
  boundProjectIds: readonly string[];
}): string | undefined {
  const soleProjectId =
    boundProjectIds.length === 1 ? boundProjectIds[0] : undefined;
  return listProjectId ?? soleProjectId;
}

/**
 * Where a list row opens: the automation's Editor tab — its default surface,
 * exactly as a project row opens on Tasks — inside its project shell when it
 * has one (see {@link automationTargetProjectId}), on the org detail
 * otherwise. The project-tab listing always stays inside that project.
 */
export function automationListTarget({
  organizationId,
  name,
  listProjectId,
  boundProjectIds,
}: {
  organizationId: string;
  name: string;
  listProjectId?: string;
  boundProjectIds: readonly string[];
}):
  | {
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor';
      params: {
        id: string;
        projectId: string;
        automationSlug: string;
      };
    }
  | {
      to: '/dashboard/$id/automations/$automationSlug/editor';
      params: { id: string; automationSlug: string };
    } {
  const rowProjectId = automationTargetProjectId({
    ...(listProjectId !== undefined && { listProjectId }),
    boundProjectIds,
  });
  const automationSlug = automationSlugToParam(name);
  if (rowProjectId !== undefined) {
    return {
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params: {
        id: organizationId,
        projectId: rowProjectId,
        automationSlug,
      },
    };
  }
  return {
    to: '/dashboard/$id/automations/$automationSlug/editor',
    params: { id: organizationId, automationSlug },
  };
}
