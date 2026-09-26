import { createFileRoute } from '@tanstack/react-router';

import { TaskDetailPage } from '@/app/features/tasks/components/task-detail-page';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { seo } from '@/lib/utils/seo';

/**
 * A task on its own page — where Home opens a task, beside the Home panel,
 * the way it opens a chat or a conversation. The project board keeps opening
 * tasks in its dialog (`?task=`); both render the same detail.
 */
export const Route = createFileRoute('/dashboard/$id/tasks/$taskId')({
  head: () => ({
    meta: seo('task'),
  }),
  loader: ({ context, params }) => {
    prefetchAdaptedQuery(context.queryClient, 'tasks/queries:getTask', {
      organizationId: params.id,
      taskId: params.taskId,
    });
  },
  component: TaskRoute,
});

function TaskRoute() {
  const { id: organizationId, taskId } = Route.useParams();
  return <TaskDetailPage organizationId={organizationId} taskId={taskId} />;
}
