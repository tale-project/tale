import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AutomationDetailShell } from '@/app/features/automations/components/automation-detail-shell';
import { loadAutomationName } from '@/app/features/automations/lib/load-automation-name';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug',
)({
  loader: async ({
    context,
    params,
  }): Promise<{ automationName: string | undefined }> => ({
    automationName: await loadAutomationName(
      context,
      params.id,
      params.automationSlug,
    ),
  }),
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
