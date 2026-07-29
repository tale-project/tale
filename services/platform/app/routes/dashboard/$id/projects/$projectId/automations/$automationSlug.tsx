import { createFileRoute, Outlet } from '@tanstack/react-router';

import { PageLayout } from '@/app/components/layout/page-layout';
import { ActiveEditorProvider } from '@/app/components/ui/editor';
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
 * scrolling page frame, and the `ActiveEditorProvider` the automation page's
 * Save/Discard cluster reads. Like the org-level area layout, this renders no
 * cluster itself, so the page keeps exactly one.
 */
function ProjectAutomationShell() {
  const { id: organizationId } = Route.useParams();
  return (
    <ActiveEditorProvider>
      <PageLayout organizationId={organizationId}>
        <Outlet />
      </PageLayout>
    </ActiveEditorProvider>
  );
}
