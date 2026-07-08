import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

import { useInvalidateAutomations } from './use-automations';

/**
 * Automation-specific presign mutation for the private automation upload path. Distinct from
 * the generic `files.mutations.generateUploadUrl` because the Automations surface
 * requires the developer-settings capability the generic mutation doesn't
 * enforce.
 */
export function useGenerateAutomationUploadUrl() {
  return useConvexMutation(
    api.automations.upload_mutations.generateAutomationUploadUrl,
  );
}

/**
 * Bind the freshly-POSTed `_storage` blob to the org + caller. Required before
 * `uploadAutomationBundle` will trust the storageId — without an intent row the action
 * rejects with `STORAGE_NOT_OWNED`.
 */
export function useRecordAutomationUploadIntent() {
  return useConvexMutation(
    api.automations.upload_mutations.recordAutomationUploadIntent,
  );
}

export function useUploadAutomationBundle() {
  const invalidate = useInvalidateAutomations();
  return useConvexAction(
    api.automations.upload_actions.uploadAutomationBundle,
    {
      onSuccess: (_data, variables) => invalidate(variables.organizationId),
    },
  );
}

/**
 * Delete a private (uploaded) automation's on-disk bundle. The server refuses a
 * built-in slug or an automation with an active install (uninstall it first), so this
 * is only offered on uploaded, not-installed automations. Invalidates the hub list so
 * the deleted card drops out.
 */
export function useDeleteAutomation() {
  const invalidate = useInvalidateAutomations();
  return useConvexAction(api.automations.upload_actions.deleteAutomation, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}
