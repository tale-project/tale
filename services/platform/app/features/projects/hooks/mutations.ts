import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useCreateProject() {
  return useBackendMutation('projects/mutations:createProject');
}

export function useUpdateProjectIdentity() {
  return useBackendMutation('projects/mutations:updateProjectIdentity');
}

export function useUpdateProjectInstructions() {
  return useBackendMutation('projects/mutations:updateProjectInstructions');
}

export function useUpdateProjectSharing() {
  return useBackendMutation('projects/mutations:updateProjectSharing');
}

export function useCreateProjectAgent() {
  return useBackendMutation('projects/mutations:createProjectAgent');
}

export function useUpdateProjectAgent() {
  return useBackendMutation('projects/mutations:updateProjectAgent');
}

export function useDeleteProjectAgent() {
  return useBackendMutation('projects/mutations:deleteProjectAgent');
}

/** Org agent secrets: the value is encrypted server-side in a Node action
 * (`lib/secret_box`), so the write path is an action, not a mutation. */
export function useUpsertAgentSecret() {
  return useBackendAction('agent_secrets/actions:upsertAgentSecret');
}

export function useDeleteAgentSecret() {
  return useBackendMutation('agent_secrets/mutations:deleteAgentSecret');
}

export function useDetachDocumentFromProject() {
  return useBackendMutation('projects/mutations:detachDocumentFromProject');
}

export function useSetThreadSharedWithProject() {
  return useBackendMutation('chat/threads:setThreadSharedWithProject');
}

export function useArchiveProject() {
  return useBackendMutation('projects/mutations:archiveProject');
}

export function useRestoreProject() {
  return useBackendMutation('projects/mutations:restoreProject');
}

export function useDeleteProject() {
  return useBackendMutation('projects/mutations:deleteProject');
}

export function useDuplicateProject() {
  return useBackendMutation('projects/mutations:duplicateProject');
}
