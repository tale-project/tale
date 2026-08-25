import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { TasksPageSkeleton } from '@/app/features/tasks/components/tasks-skeleton';
import {
  isAllProjectsSearch,
  persistTaskView,
  TASK_VIEW_ROUTES,
  type TaskView,
  validateTaskSearch,
} from '@/app/features/tasks/lib/view';
import { lazyComponent } from '@/lib/utils/lazy-component';

const TasksWorkspace = lazyComponent(
  () =>
    import('@/app/features/tasks/components/tasks-workspace').then((mod) => ({
      default: mod.TasksWorkspace,
    })),
  // The chunk fallback IS the board skeleton — the same one the workspace
  // shows while task data loads, so navigation → chunk → data is one
  // continuous skeleton with no layout shift.
  { loading: () => <TasksPageSkeleton view="board" /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/tasks/board',
)({
  // `?task=<id>` deep-links straight into a task's detail sheet — shareable
  // task URLs, and the target of inbox/notification links (review requests).
  // `?projects=all` is the cross-project aggregate scope.
  validateSearch: validateTaskSearch,
  // Warm the TasksWorkspace chunk during the loader so it's cached by render
  // time — removes the Suspense fallback flash on first nav. The project tab
  // links preload on render, so this typically fires before the user clicks.
  loader: () => {
    void import('@/app/features/tasks/components/tasks-workspace');
  },
  component: TasksBoardPage,
});

function TasksBoardPage() {
  const { id: organizationId, projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const allProjects = isAllProjectsSearch(search);

  // Remember the last-visited view so the bare `/tasks` alias reopens it.
  useEffect(() => persistTaskView(projectId, 'board'), [projectId]);

  return (
    <TasksWorkspace
      organizationId={organizationId}
      projectId={projectId}
      view="board"
      allProjects={allProjects}
      onViewChange={(next: TaskView) => {
        void navigate({
          to: TASK_VIEW_ROUTES[next],
          params: { id: organizationId, projectId },
          search: (prev) => prev,
        });
      }}
      openTaskParam={search.task}
      onOpenTaskParamChange={(taskId: string | null) => {
        void navigate({
          search: (prev) => {
            const next = { ...prev };
            if (taskId) next.task = taskId;
            else delete next.task;
            return next;
          },
          replace: true,
        });
      }}
    />
  );
}
