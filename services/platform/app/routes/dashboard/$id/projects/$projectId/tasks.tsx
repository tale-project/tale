import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { lazyComponent } from '@/lib/utils/lazy-component';

function TasksChunkFallback() {
  return (
    <ContentArea gap={4} className="py-4">
      <Skeletonize loading>
        <SkeletonText lines={1} />
        <SkeletonText lines={5} />
      </Skeletonize>
    </ContentArea>
  );
}

const TasksWorkspace = lazyComponent(
  () =>
    import('@/app/features/tasks/components/tasks-workspace').then((mod) => ({
      default: mod.TasksWorkspace,
    })),
  { loading: () => <TasksChunkFallback /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/tasks',
)({
  component: ProjectTasksPage,
});

function ProjectTasksPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <TasksWorkspace organizationId={organizationId} projectId={projectId} />
  );
}
