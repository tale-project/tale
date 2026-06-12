import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { TasksPageSkeleton } from '@/app/features/tasks/components/tasks-skeleton';
import {
  persistTaskView,
  validateTaskSearch,
} from '@/app/features/tasks/lib/view';
import { lazyComponent } from '@/lib/utils/lazy-component';

const TasksWorkspace = lazyComponent(
  () =>
    import('@/app/features/tasks/components/tasks-workspace').then((mod) => ({
      default: mod.TasksWorkspace,
    })),
  // The chunk fallback IS the list skeleton — the same one the workspace
  // shows while task data loads, so navigation → chunk → data is one
  // continuous skeleton with no layout shift.
  { loading: () => <TasksPageSkeleton view="list" /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/tasks/list',
)({
  // `?task=<id>` deep-links straight into a task's detail sheet — shareable
  // task URLs, and the target of inbox/notification links (review requests).
  validateSearch: validateTaskSearch,
  // Warm the TasksWorkspace chunk during the loader so it's cached by render
  // time — removes the Suspense fallback flash on first nav. The project tab
  // links preload on render, so this typically fires before the user clicks.
  loader: () => {
    void import('@/app/features/tasks/components/tasks-workspace');
  },
  component: TasksListPage,
});

function TasksListPage() {
  const { id: organizationId, projectId } = Route.useParams();
  const { task } = Route.useSearch();
  const navigate = Route.useNavigate();

  // Remember the last-visited view so the bare `/tasks` alias reopens it.
  useEffect(() => persistTaskView(projectId, 'list'), [projectId]);

  return (
    <TasksWorkspace
      organizationId={organizationId}
      projectId={projectId}
      view="list"
      onViewChange={() => {
        void navigate({
          to: '/dashboard/$id/projects/$projectId/tasks/board',
          params: { id: organizationId, projectId },
          search: (prev) => prev,
        });
      }}
      openTaskParam={task}
      onOpenTaskParamChange={(taskId: string | null) => {
        void navigate({
          search: taskId ? { task: taskId } : {},
          replace: true,
        });
      }}
    />
  );
}
