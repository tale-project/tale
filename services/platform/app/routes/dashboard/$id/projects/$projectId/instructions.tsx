import { createFileRoute, redirect } from '@tanstack/react-router';

// The project's instructions moved onto the project's general page, next to
// identity — they are a property of the project, not a place to navigate to.
// Kept as a redirect so existing links and bookmarks keep working.
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/instructions',
)({
  loader: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/projects/$projectId/overview',
      params: { id: params.id, projectId: params.projectId },
    });
  },
});
