import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useT } from '@/lib/i18n/client';
import {
  backendErrorCode,
  backendUserMessage,
} from '@/lib/utils/backend-error';

import { reviewPolicyErrorMessage } from '../lib/review-policy-error';

export function useCreateTask() {
  return useBackendMutation('tasks/mutations:createTask');
}

export function useUpdateTask() {
  return useBackendMutation('tasks/mutations:updateTask');
}

export function useUpdateTaskStatus() {
  return useBackendMutation('tasks/mutations:updateTaskStatus');
}

export function useAssignTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  // A live run holds the task for its current worker, so the server refuses
  // a mid-run transfer (`TASK_HAS_LIVE_RUN`) — name the reason on every
  // picker (board card, list row, sheet) instead of the generic failure copy.
  return useBackendMutation('tasks/mutations:assignTask', {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        backendErrorCode(error) === 'TASK_HAS_LIVE_RUN'
          ? t('assignee.liveRunGuard')
          : backendUserMessage(error, tToast('error.generic.description')),
    },
  });
}

export function useClaimTask() {
  return useBackendMutation('tasks/mutations:claimTask');
}

export function useAddTaskComment() {
  return useBackendMutation('tasks/mutations:addTaskComment');
}

export function useEditTaskComment() {
  return useBackendMutation('tasks/mutations:editTaskDiscussionMessage');
}

export function useDeleteTaskComment() {
  return useBackendMutation('tasks/mutations:deleteTaskDiscussionMessage');
}

export function useArchiveTask() {
  return useBackendMutation('tasks/mutations:archiveTask');
}

export function useRestoreTask() {
  return useBackendMutation('tasks/mutations:restoreTask');
}

export function useDeleteTask() {
  return useBackendMutation('tasks/mutations:deleteTask');
}

export function useMoveTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  // Dropping In review → Done IS the review approve, so the org's
  // review_policy can refuse a drag — name the reason instead of the generic
  // failure copy (the card still snaps back either way).
  return useBackendMutation('tasks/mutations:moveTask', {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        reviewPolicyErrorMessage(error, t) ??
        backendUserMessage(error, tToast('error.generic.description')),
    },
  });
}

export function useAddTaskDependency() {
  return useBackendMutation('tasks/mutations:addTaskDependency');
}

export function useRemoveTaskDependency() {
  return useBackendMutation('tasks/mutations:removeTaskDependency');
}

export function useUpdateTaskLabel() {
  return useBackendMutation('tasks/mutations:updateTaskLabel');
}

export function useCreateTaskLabel() {
  return useBackendMutation('tasks/mutations:createTaskLabel');
}

export function useEnsureDefaultTaskLabels() {
  return useBackendMutation('tasks/mutations:ensureDefaultTaskLabels');
}

export function useDeleteTaskLabel() {
  return useBackendMutation('tasks/mutations:deleteTaskLabel');
}

export function useSetTaskReviewer() {
  return useBackendMutation('tasks/review_mutations:setTaskReviewer');
}

export function useStartTaskAgentRun() {
  return useBackendMutation('tasks/mutations:startTaskAgentRun');
}

export function useCancelTaskAgentRun() {
  return useBackendMutation('tasks/mutations:cancelTaskAgentRun');
}

export function useSubscribeToTask() {
  return useBackendMutation('collab/subscriptions:subscribeToTask');
}

export function useUnsubscribeFromTask() {
  return useBackendMutation('collab/subscriptions:unsubscribeFromTask');
}

export function useSetTaskMuted() {
  return useBackendMutation('collab/subscriptions:setTaskMuted');
}
