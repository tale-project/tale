import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
import { AutomationBreadcrumbs } from '@/app/features/automations/components/automation-breadcrumbs';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { paramToAutomationSlug } from '@/lib/automations/slug';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug',
)({
  head: () => ({
    meta: seo('automation'),
  }),
  component: ProjectAutomationShell,
});

/**
 * Shell for a project-scoped automation and its runs.
 *
 * The project layout hands these routes a bare outlet — an automation's canvas
 * is not one of the project's tabs — so the shell they need is owned here: the
 * scrolling page frame, the Automations / <name> breadcrumb chrome, and the
 * `ActiveEditorProvider` the automation page's Save/Discard cluster reads.
 * Like the org-level area layout, this renders no cluster itself, so the page
 * keeps exactly one.
 */
function ProjectAutomationShell() {
  const {
    id: organizationId,
    projectId,
    automationSlug: automationSlugParam,
  } = Route.useParams();
  const automationSlug = paramToAutomationSlug(automationSlugParam);

  return (
    <ActiveEditorProvider>
      <PageLayout
        organizationId={organizationId}
        header={
          <AdaptiveHeaderRoot standalone={false} className="gap-2">
            <AutomationBreadcrumbs
              organizationId={organizationId}
              automationSlug={automationSlug}
              projectId={asProjectId(projectId)}
            />
          </AdaptiveHeaderRoot>
        }
      >
        <Outlet />
      </PageLayout>
    </ActiveEditorProvider>
  );
}
