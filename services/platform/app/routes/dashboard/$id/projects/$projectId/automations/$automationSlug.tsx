import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { ensureAdaptedQueryData } from '@/app/lib/backend/prefetch';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { i18n } from '@/lib/i18n/i18n';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug',
)({
  loader: async ({
    context,
    params,
  }): Promise<{ automationName: string | undefined }> => {
    // Same warm-up as the org-level detail: the name reaches `head()` for
    // the document title, and the shell's query resolves from cache.
    const name = paramToAutomationSlug(params.automationSlug);
    const automation = await ensureAdaptedQueryData(
      context.queryClient,
      'automations/queries:getAutomation',
      { organizationId: params.id, name },
    ).catch((error: unknown) => {
      console.warn('Failed to load automation for document title', error);
      return null;
    });
    return {
      automationName:
        automation === null
          ? undefined
          : automationDisplayName(automation.presentation, name, i18n.language),
    };
  },
  head: ({ loaderData }) => ({
    meta: seo('automation', loaderData?.automationName),
  }),
  component: ProjectAutomationShell,
});

/**
 * Shell for a project-scoped automation, its tabs and its runs.
 *
 * The project layout hands these routes a bare outlet — an automation's canvas
 * is not one of the project's tabs — so the chrome they need is the same
 * `AutomationDetailShell` the org area renders, told to keep every link inside
 * `/projects/$projectId/…`.
 */
function ProjectAutomationShell() {
  const { id: organizationId, projectId, automationSlug } = Route.useParams();
  return (
    <AutomationDetailShell
      organizationId={organizationId}
      automationSlug={paramToAutomationSlug(automationSlug)}
      projectId={asProjectId(projectId)}
    >
      <Outlet />
    </AutomationDetailShell>
  );
}
