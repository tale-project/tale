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

export function useUpdateProjectIntegrationSettings() {
  return useConvexMutation(
    api.projects.mutations.updateProjectIntegrationSettings,
  );
}

export function useAttachDocumentToProject() {
  return useConvexMutation(api.projects.mutations.attachDocumentToProject);
}

export function useDetachDocumentFromProject() {
  return useConvexMutation(api.projects.mutations.detachDocumentFromProject);
}

export function useMoveThreadToProject() {
  return useConvexMutation(api.projects.mutations.moveThreadToProject);
}

export function useSetThreadSharedWithProject() {
  return useConvexMutation(api.projects.mutations.setThreadSharedWithProject);
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
