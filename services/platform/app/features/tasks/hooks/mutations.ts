import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useT } from '@/lib/i18n/client';
import {
  backendErrorCode,
  backendUserMessage,
  invalidBodyReason,
} from '@/lib/utils/backend-error';

import { reviewPolicyErrorMessage } from '../lib/review-policy-error';
import { useNextTaskToast } from './use-next-task-toast';

// A write below that passes `errorToast: false` has callers that all report
// its failure in their own toast — a refusal the surface knows by its house
// sentence, anything else with the door's own words — so its default toast
// would report the same failure a second time. The comment and watch writes
// keep the default toast: their callers only log.

export function useCreateTask() {
  return useBackendMutation('tasks/mutations:createTask', {
    errorToast: false,
  });
}

/** The task modal reports a failed edit itself and passes
 * `errorToast: false`; the board card and the list row keep the default
 * toast. */
export function useUpdateTask(options?: { errorToast?: false }) {
  return useBackendMutation('tasks/mutations:updateTask', options);
}

export function useUpdateTaskStatus() {
  const announceNextTask = useNextTaskToast();
  return useBackendMutation('tasks/mutations:updateTaskStatus', {
    errorToast: false,
    onSuccess: announceNextTask,
  });
}

export function useAssignTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  // A live run holds the task for its current worker, so the server refuses
  // a mid-run transfer (`TASK_HAS_LIVE_RUN`) — name the reason on every
  // picker (board card, list row, sheet) instead of the generic failure copy.
  // This toast is every picker's one report: none toasts a failure itself.
  return useBackendMutation('tasks/mutations:assignTask', {
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        backendErrorCode(error) === 'TASK_HAS_LIVE_RUN'
          ? t('assignee.liveRunGuard')
          : backendUserMessage(
              error,
              invalidBodyReason(error) ?? tToast('error.generic.description'),
            ),
    },
  });
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
  return useBackendMutation('tasks/mutations:archiveTask', {
    errorToast: false,
  });
}

export function useRestoreTask() {
  return useBackendMutation('tasks/mutations:restoreTask', {
    errorToast: false,
  });
}

/** Delete a task with its subtasks for good (owners and admins only). */
export function useDeleteTask() {
  return useBackendMutation('tasks/mutations:deleteTask', {
    errorToast: false,
  });
}

export function useMoveTask() {
  const { t } = useT('tasks');
  const { t: tToast } = useT('toast');
  const announceNextTask = useNextTaskToast();
  // Dropping In review → Done IS the review approve, so the org's
  // review_policy can refuse a drag — name the reason instead of the generic
  // failure copy (the card still snaps back either way).
  return useBackendMutation('tasks/mutations:moveTask', {
    onSuccess: announceNextTask,
    errorToast: {
      title: tToast('error.generic.title'),
      description: (error) =>
        reviewPolicyErrorMessage(error, t) ??
        backendUserMessage(
          error,
          invalidBodyReason(error) ?? tToast('error.generic.description'),
        ),
    },
  });
}

export function useAddTaskDependency() {
  return useBackendMutation('tasks/mutations:addTaskDependency', {
    errorToast: false,
  });
}

export function useRemoveTaskDependency() {
  return useBackendMutation('tasks/mutations:removeTaskDependency', {
    errorToast: false,
  });
}

export function useUpdateTaskLabel() {
  return useBackendMutation('tasks/mutations:updateTaskLabel', {
    errorToast: false,
  });
}

export function useCreateTaskLabel() {
  return useBackendMutation('tasks/mutations:createTaskLabel', {
    errorToast: false,
  });
}

export function useEnsureDefaultTaskLabels() {
  return useBackendMutation('tasks/mutations:ensureDefaultTaskLabels');
}

export function useDeleteTaskLabel() {
  return useBackendMutation('tasks/mutations:deleteTaskLabel', {
    errorToast: false,
  });
}

export function useSetTaskReviewer() {
  return useBackendMutation('tasks/review_mutations:setTaskReviewer', {
    errorToast: false,
  });
}

export function useStartTaskAgentRun() {
  return useBackendMutation('tasks/mutations:startTaskAgentRun', {
    errorToast: false,
  });
}

/** The run entry's Cancel reports a failure itself and passes
 * `errorToast: false`; the assignee picker's hand-off and a status move that
 * cuts a live run keep the default toast. */
export function useCancelTaskAgentRun(options?: { errorToast?: false }) {
  return useBackendMutation('tasks/mutations:cancelTaskAgentRun', options);
}

export function useSubscribeToTask() {
  return useBackendMutation('collab/subscriptions:subscribeToTask');
}

export function useSetTaskMuted() {
  return useBackendMutation('collab/subscriptions:setTaskMuted');
}
