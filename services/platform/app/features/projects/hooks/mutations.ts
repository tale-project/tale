import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateProject() {
  return useConvexMutation(api.projects.mutations.createProject);
}

export function useUpdateProjectIdentity() {
  return useConvexMutation(api.projects.mutations.updateProjectIdentity);
}

export function useUpdateProjectInstructions() {
  return useConvexMutation(api.projects.mutations.updateProjectInstructions);
}

export function useUpdateProjectSharing() {
  return useConvexMutation(api.projects.mutations.updateProjectSharing);
}

export function useUpdateProjectKnowledgeMode() {
  return useConvexMutation(api.projects.mutations.updateProjectKnowledgeMode);
}

export function useUpdateProjectAgentSettings() {
  return useConvexMutation(api.projects.mutations.updateProjectAgentSettings);
}

export function useUpdateProjectModelSettings() {
  return useConvexMutation(api.projects.mutations.updateProjectModelSettings);
}

export function useUpdateProjectConnectorSettings() {
  return useConvexMutation(
    api.projects.mutations.updateProjectConnectorSettings,
  );
}

export function useCreateProjectAgent() {
  return useConvexMutation(api.projects.mutations.createProjectAgent);
}

export function useUpdateProjectAgent() {
  return useConvexMutation(api.projects.mutations.updateProjectAgent);
}

export function useDeleteProjectAgent() {
  return useConvexMutation(api.projects.mutations.deleteProjectAgent);
}

export function useDetachDocumentFromProject() {
  return useConvexMutation(api.projects.mutations.detachDocumentFromProject);
}

export function useMoveThreadToProject() {
  return useConvexMutation(api.projects.mutations.moveThreadToProject);
}

export function useSetProjectPinned() {
  return useConvexMutation(api.projects.mutations.setProjectPinned);
}

export function useSetThreadSharedWithProject() {
  return useConvexMutation(api.chat.threads.setThreadSharedWithProject);
}

export function useArchiveProject() {
  return useConvexMutation(api.projects.mutations.archiveProject);
}

export function useRestoreProject() {
  return useConvexMutation(api.projects.mutations.restoreProject);
}

export function useDeleteProject() {
  return useConvexMutation(api.projects.mutations.deleteProject);
}

export function useDuplicateProject() {
  return useConvexMutation(api.projects.mutations.duplicateProject);
}
