import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useT } from '@/lib/i18n/client';
import { convexUserMessage } from '@/lib/utils/convex-error';

import { reviewPolicyErrorMessage } from '../lib/review-policy-error';

export function useCreateTask() {
  return useConvexMutation('tasks/mutations:createTask');
}

export function useUpdateTask() {
  return useConvexMutation('tasks/mutations:updateTask');
}

export function useUpdateTaskStatus() {
  return useConvexMutation('tasks/mutations:updateTaskStatus');
}

export function useAssignTask() {
  return useConvexMutation('tasks/mutations:assignTask');
}

export function useClaimTask() {
  return useConvexMutation('tasks/mutations:claimTask');
}

export function useAddTaskComment() {
  return useConvexMutation('tasks/mutations:addTaskComment');
}

export function useEditTaskComment() {
  return useConvexMutation('tasks/mutations:editTaskDiscussionMessage');
}

export function useDeleteTaskComment() {
  return useConvexMutation('tasks/mutations:deleteTaskDiscussionMessage');
}

export function useArchiveTask() {
  return useConvexMutation('tasks/mutations:archiveTask');
}

export function useRestoreTask() {
  return useConvexMutation('tasks/mutations:restoreTask');
}

export function useDeleteTask() {
  return useConvexMutation('tasks/mutations:deleteTask');
}

export function useMoveTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  // Dropping In review → Done IS the review approve, so the org's
  // review_policy can refuse a drag — name the reason instead of the generic
  // failure copy (the card still snaps back either way).
  return useConvexMutation('tasks/mutations:moveTask', {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        reviewPolicyErrorMessage(error, t) ??
        convexUserMessage(error, tToast('error.generic.description')),
    },
  });
}

export function useAddTaskDependency() {
  return useConvexMutation('tasks/mutations:addTaskDependency');
}

export function useRemoveTaskDependency() {
  return useConvexMutation('tasks/mutations:removeTaskDependency');
}

export function useBulkUpdateTasks() {
  return useConvexMutation('tasks/mutations:bulkUpdateTasks');
}

export function useUpdateTaskLabel() {
  return useConvexMutation('tasks/mutations:updateTaskLabel');
}

export function useCreateTaskLabel() {
  return useConvexMutation('tasks/mutations:createTaskLabel');
}

export function useEnsureDefaultTaskLabels() {
  return useConvexMutation('tasks/mutations:ensureDefaultTaskLabels');
}

export function useDeleteTaskLabel() {
  return useConvexMutation('tasks/mutations:deleteTaskLabel');
}

export function useSaveBoardView() {
  return useConvexMutation('tasks/mutations:saveBoardView');
}

export function useDeleteBoardView() {
  return useConvexMutation('tasks/mutations:deleteBoardView');
}

export function useSetTaskReviewer() {
  return useConvexMutation('tasks/review_mutations:setTaskReviewer');
}

export function useStartTaskAgentRun() {
  return useConvexMutation('tasks/mutations:startTaskAgentRun');
}

export function useCancelTaskAgentRun() {
  return useConvexMutation('tasks/mutations:cancelTaskAgentRun');
}

export function useSubscribeToTask() {
  return useConvexMutation('collab/subscriptions:subscribeToTask');
}

export function useUnsubscribeFromTask() {
  return useConvexMutation('collab/subscriptions:unsubscribeFromTask');
}

export function useSetTaskMuted() {
  return useConvexMutation('collab/subscriptions:setTaskMuted');
}
