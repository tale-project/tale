import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  persistTaskView,
  validateTaskSearch,
} from '@/app/features/tasks/lib/view';

/**
 * The backlog tab was retired — backlog is a board/list status lane again.
 * Forward bookmarked `/tasks/backlog` URLs to the board (preserving `?task=`).
 */
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/tasks/backlog',
)({
  validateSearch: validateTaskSearch,
  beforeLoad: ({ params, search }) => {
    // Migrate any stored "last view = backlog" preference so `/tasks` reopens
    // the board after this redirect (SPA — localStorage is available here).
    persistTaskView(params.projectId, 'board');
    throw redirect({
      to: '/dashboard/$id/projects/$projectId/tasks/board',
      params,
      search,
      replace: true,
    });
  },
});
