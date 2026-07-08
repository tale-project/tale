import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug',
)({
  component: ProjectAutomationLayout,
});

/**
 * Layout for a project-scoped automation + its nested run-detail page, rendered INSIDE
 * the project shell (the project's tab strip stays visible, the automation's tab
 * active). The automation renders at the index child; `/runs/$executionId` renders
 * through the Outlet so run-watching stays in-context. Mirrors the org-level
 * `automations/$automationSlug` layout, one level deeper under the project.
 *
 * A flex column (not a plain block div) so the index route's Editor tab can
 * chain `flex-1 min-h-0` up to the project shell's `PageLayout` and have the
 * workflow canvas fill the available height; every other tab renders at its
 * natural height inside this same box.
 */
function ProjectAutomationLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <Outlet />
    </div>
  );
}
