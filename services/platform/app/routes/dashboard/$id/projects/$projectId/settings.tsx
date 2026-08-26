import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * U8: Settings tab merged into Overview. Identity edit + Sharing live in
 * the Overview header now; Archive/Delete are in the 3-dot row menu on
 * the projects list page. Deep links to `/settings` redirect to General
 * (`/overview`) so bookmarks keep working.
 */
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/settings',
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/projects/$projectId/overview',
      params: {
        id: params.id,
        projectId: params.projectId,
      },
    });
  },
});
