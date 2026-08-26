import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Bare `/projects/$projectId` is an alias, not a page: list rows, create
 * success, search hits, and notification fallbacks land here and forward to
 * Tasks (the project's default working surface). General stays at `/overview`.
 */
export const Route = createFileRoute('/dashboard/$id/projects/$projectId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/dashboard/$id/projects/$projectId/tasks',
      params,
      replace: true,
    });
  },
});
