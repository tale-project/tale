import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/apps/$appSlug',
)({
  component: ProjectAppLayout,
});

/**
 * Layout for a project-scoped app + its nested run-detail page, rendered INSIDE
 * the project shell (the project's tab strip stays visible, the app's tab
 * active). The app renders at the index child; `/runs/$executionId` renders
 * through the Outlet so run-watching stays in-context. Mirrors the org-level
 * `apps/$appSlug` layout, one level deeper under the project.
 */
function ProjectAppLayout() {
  return (
    <div className="p-4">
      <Outlet />
    </div>
  );
}
