import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

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
  return useConvexMutation(api.tasks.mutations.editTaskComment);
}

export function useDeleteTaskComment() {
  return useConvexMutation(api.tasks.mutations.deleteTaskComment);
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
  return useConvexMutation(api.tasks.mutations.moveTask);
}

export function useBulkUpdateTasks() {
  return useConvexMutation(api.tasks.mutations.bulkUpdateTasks);
}

export function useSaveBoardView() {
  return useConvexMutation(api.tasks.mutations.saveBoardView);
}

export function useDeleteBoardView() {
  return useConvexMutation(api.tasks.mutations.deleteBoardView);
}
