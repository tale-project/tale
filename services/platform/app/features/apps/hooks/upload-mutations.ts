import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

import { useInvalidateApps } from './use-apps';

/**
 * App-specific presign mutation for the private-app upload path. Distinct from
 * the generic `files.mutations.generateUploadUrl` because the Apps surface
 * requires the developer-settings capability the generic mutation doesn't
 * enforce.
 */
export function useGenerateAppUploadUrl() {
  return useConvexMutation(api.apps.upload_mutations.generateAppUploadUrl);
}

/**
 * Bind the freshly-POSTed `_storage` blob to the org + caller. Required before
 * `uploadAppBundle` will trust the storageId — without an intent row the action
 * rejects with `STORAGE_NOT_OWNED`.
 */
export function useRecordAppUploadIntent() {
  return useConvexMutation(api.apps.upload_mutations.recordAppUploadIntent);
}

export function useUploadAppBundle() {
  const invalidate = useInvalidateApps();
  return useConvexAction(api.apps.upload_actions.uploadAppBundle, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}

/**
 * Delete a private (uploaded) app's on-disk bundle. The server refuses a
 * built-in slug or an app with an active install (uninstall it first), so this
 * is only offered on uploaded, not-installed apps. Invalidates the hub list so
 * the deleted card drops out.
 */
export function useDeleteApp() {
  const invalidate = useInvalidateApps();
  return useConvexAction(api.apps.upload_actions.deleteApp, {
    onSuccess: (_data, variables) => invalidate(variables.organizationId),
  });
}
