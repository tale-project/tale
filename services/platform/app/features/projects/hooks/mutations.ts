import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useCreateProject() {
  return useConvexMutation('projects/mutations:createProject');
}

export function useUpdateProjectIdentity() {
  return useConvexMutation('projects/mutations:updateProjectIdentity');
}

export function useUpdateProjectInstructions() {
  return useConvexMutation('projects/mutations:updateProjectInstructions');
}

export function useUpdateProjectSharing() {
  return useConvexMutation('projects/mutations:updateProjectSharing');
}

export function useUpdateProjectKnowledgeMode() {
  return useConvexMutation('projects/mutations:updateProjectKnowledgeMode');
}

export function useUpdateProjectAgentSettings() {
  return useConvexMutation('projects/mutations:updateProjectAgentSettings');
}

export function useUpdateProjectModelSettings() {
  return useConvexMutation('projects/mutations:updateProjectModelSettings');
}

export function useUpdateProjectConnectorSettings() {
  return useConvexMutation('projects/mutations:updateProjectConnectorSettings');
}

export function useCreateProjectAgent() {
  return useConvexMutation('projects/mutations:createProjectAgent');
}

export function useUpdateProjectAgent() {
  return useConvexMutation('projects/mutations:updateProjectAgent');
}

export function useDeleteProjectAgent() {
  return useConvexMutation('projects/mutations:deleteProjectAgent');
}

/** Org agent secrets: the value is encrypted server-side in a Node action
 * (`lib/secret_box`), so the write path is an action, not a mutation. */
export function useUpsertAgentSecret() {
  return useConvexAction('agent_secrets/actions:upsertAgentSecret');
}

export function useDeleteAgentSecret() {
  return useConvexMutation('agent_secrets/mutations:deleteAgentSecret');
}

export function useDetachDocumentFromProject() {
  return useConvexMutation('projects/mutations:detachDocumentFromProject');
}

export function useMoveThreadToProject() {
  return useConvexMutation('projects/mutations:moveThreadToProject');
}

export function useSetProjectPinned() {
  return useConvexMutation('projects/mutations:setProjectPinned');
}

export function useSetThreadSharedWithProject() {
  return useConvexMutation('chat/threads:setThreadSharedWithProject');
}

export function useArchiveProject() {
  return useConvexMutation('projects/mutations:archiveProject');
}

export function useRestoreProject() {
  return useConvexMutation('projects/mutations:restoreProject');
}

export function useDeleteProject() {
  return useConvexMutation('projects/mutations:deleteProject');
}

export function useDuplicateProject() {
  return useConvexMutation('projects/mutations:duplicateProject');
}
