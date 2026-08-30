import { automationSlugToParam } from '@/lib/automations/slug';

/**
 * Where a list row opens.
 *
 * A single-bound automation opens inside its project shell; org-level and
 * multi-bound ones stay on the org detail — there is no one project to route
 * into. The project-tab listing always stays inside that project.
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
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug';
      params: {
        id: string;
        projectId: string;
        automationSlug: string;
      };
    }
  | {
      to: '/dashboard/$id/automations/$automationSlug';
      params: { id: string; automationSlug: string };
    } {
  const soleProjectId =
    boundProjectIds.length === 1 ? boundProjectIds[0] : undefined;
  const rowProjectId = listProjectId ?? soleProjectId;
  const automationSlug = automationSlugToParam(name);
  if (rowProjectId !== undefined) {
    return {
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: organizationId,
        projectId: rowProjectId,
        automationSlug,
      },
    };
  }
  return {
    to: '/dashboard/$id/automations/$automationSlug',
    params: { id: organizationId, automationSlug },
  };
}
