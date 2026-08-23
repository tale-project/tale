import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { convexUserMessage } from '@/lib/utils/convex-error';

import { reviewPolicyErrorMessage } from '../lib/review-policy-error';

export function useCreateTask() {
  return useConvexMutation(api.tasks.mutations.createTask);
}

export function useUpdateTask() {
  return useConvexMutation(api.tasks.mutations.updateTask);
}

export function useUpdateTaskStatus() {
  return useConvexMutation(api.tasks.mutations.updateTaskStatus);
}

export function useAssignTask() {
  return useConvexMutation(api.tasks.mutations.assignTask);
}

export function useClaimTask() {
  return useConvexMutation(api.tasks.mutations.claimTask);
}

export function useAddTaskComment() {
  return useConvexMutation(api.tasks.mutations.addTaskComment);
}

export function useEditTaskComment() {
  return useConvexMutation(api.tasks.mutations.editTaskDiscussionMessage);
}

export function useDeleteTaskComment() {
  return useConvexMutation(api.tasks.mutations.deleteTaskDiscussionMessage);
}

export function useArchiveTask() {
  return useConvexMutation(api.tasks.mutations.archiveTask);
}

export function useRestoreTask() {
  return useConvexMutation(api.tasks.mutations.restoreTask);
}

export function useDeleteTask() {
  return useConvexMutation(api.tasks.mutations.deleteTask);
}

export function useMoveTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  // Dropping In review → Done IS the review approve, so the org's
  // review_policy can refuse a drag — name the reason instead of the generic
  // failure copy (the card still snaps back either way).
  return useConvexMutation(api.tasks.mutations.moveTask, {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        reviewPolicyErrorMessage(error, t) ??
        convexUserMessage(error, tToast('error.generic.description')),
    },
  });
}

export function useAddTaskDependency() {
  return useConvexMutation(api.tasks.mutations.addTaskDependency);
}

export function useRemoveTaskDependency() {
  return useConvexMutation(api.tasks.mutations.removeTaskDependency);
}

export function useBulkUpdateTasks() {
  return useConvexMutation(api.tasks.mutations.bulkUpdateTasks);
}

export function useUpdateTaskLabel() {
  return useConvexMutation(api.tasks.mutations.updateTaskLabel);
}

export function useCreateTaskLabel() {
  return useConvexMutation(api.tasks.mutations.createTaskLabel);
}

export function useEnsureDefaultTaskLabels() {
  return useConvexMutation(api.tasks.mutations.ensureDefaultTaskLabels);
}

export function useDeleteTaskLabel() {
  return useConvexMutation(api.tasks.mutations.deleteTaskLabel);
}

export function useSaveBoardView() {
  return useConvexMutation(api.tasks.mutations.saveBoardView);
}

export function useDeleteBoardView() {
  return useConvexMutation(api.tasks.mutations.deleteBoardView);
}

export function useSetTaskReviewer() {
  return useConvexMutation(api.tasks.review_mutations.setTaskReviewer);
}

export function useStartTaskAgentRun() {
  return useConvexMutation(api.tasks.mutations.startTaskAgentRun);
}

export function useCancelTaskAgentRun() {
  return useConvexMutation(api.tasks.mutations.cancelTaskAgentRun);
}

export function useSubscribeToTask() {
  return useConvexMutation(api.collab.subscriptions.subscribeToTask);
}

export function useUnsubscribeFromTask() {
  return useConvexMutation(api.collab.subscriptions.unsubscribeFromTask);
}

export function useSetTaskMuted() {
  return useConvexMutation(api.collab.subscriptions.setTaskMuted);
}
