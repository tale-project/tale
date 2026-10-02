import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

// Every caller of these writes reports a failure itself, and none relies on
// the default toast: a dialog, a tab or a row menu in its own toast (a
// refusal's code by its house sentence, anything else with the door's own
// words), an editor section through its Save cluster, the projects table's
// bulk archive in the bar's one toast. The default toast would report the
// same failure a second time.

export function useCreateProject() {
  return useBackendMutation('projects/mutations:createProject', {
    errorToast: false,
  });
}

export function useUpdateProjectIdentity() {
  return useBackendMutation('projects/mutations:updateProjectIdentity', {
    errorToast: false,
  });
}

export function useUpdateProjectInstructions() {
  return useBackendMutation('projects/mutations:updateProjectInstructions', {
    errorToast: false,
  });
}

export function useSetProjectTaskReviewer() {
  return useBackendMutation('projects/mutations:setProjectTaskReviewer', {
    errorToast: false,
  });
}

export function useUpdateProjectSharing() {
  return useBackendMutation('projects/mutations:updateProjectSharing', {
    errorToast: false,
  });
}

export function useCreateProjectAgent() {
  return useBackendMutation('projects/mutations:createProjectAgent', {
    errorToast: false,
  });
}

export function useUpdateProjectAgent() {
  return useBackendMutation('projects/mutations:updateProjectAgent', {
    errorToast: false,
  });
}

export function useDeleteProjectAgent() {
  return useBackendMutation('projects/mutations:deleteProjectAgent', {
    errorToast: false,
  });
}

/** The project's standard agent, created when the project has no agents of
 * its own — what picking it, or handing a chat to such a project, calls. */
export function useEnsureStandardAgent() {
  return useBackendMutation('projects/mutations:ensureStandardAgent', {
    errorToast: false,
  });
}

/** Org agent secrets: the value is encrypted server-side in a Node action
 * (`lib/secret_box`), so the write path is an action, not a mutation. */
export function useUpsertAgentSecret() {
  return useBackendAction('agent_secrets/actions:upsertAgentSecret', {
    errorToast: false,
  });
}

export function useDeleteAgentSecret() {
  return useBackendMutation('agent_secrets/mutations:deleteAgentSecret', {
    errorToast: false,
  });
}

export function useDetachDocumentFromProject() {
  return useBackendMutation('projects/mutations:detachDocumentFromProject', {
    errorToast: false,
  });
}

export function useSetThreadSharedWithProject() {
  return useBackendMutation('chat/threads:setThreadSharedWithProject', {
    errorToast: false,
  });
}

export function useArchiveProject() {
  return useBackendMutation('projects/mutations:archiveProject', {
    errorToast: false,
  });
}

export function useRestoreProject() {
  return useBackendMutation('projects/mutations:restoreProject', {
    errorToast: false,
  });
}

export function useDeleteProject() {
  return useBackendMutation('projects/mutations:deleteProject', {
    errorToast: false,
  });
}

export function useDuplicateProject() {
  return useBackendMutation('projects/mutations:duplicateProject', {
    errorToast: false,
  });
}
