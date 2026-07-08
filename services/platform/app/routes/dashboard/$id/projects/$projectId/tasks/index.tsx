import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  readPersistedTaskView,
  TASK_VIEW_ROUTES,
  validateTaskSearch,
} from '@/app/features/tasks/lib/view';

/**
 * Bare `/tasks` is an alias, not a page: every external link (project tab,
 * notification deep links with `?task=`, metrics back-link) lands here and is
 * forwarded to the user's last-visited view route (`/tasks/board` by
 * default). The view pages persist themselves on mount, so this stays in
 * step. SPA-only app — localStorage is available in `beforeLoad`.
 */
export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/tasks/',
)({
  validateSearch: validateTaskSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: TASK_VIEW_ROUTES[readPersistedTaskView(params.projectId)],
      params,
      search,
      replace: true,
    });
  },
});
