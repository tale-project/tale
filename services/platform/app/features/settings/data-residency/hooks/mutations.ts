import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Write hooks for the unified data-residency page.
 *
 * The deployment-level mutations persist the single deployment config file (one
 * atomic save, guarded by an optimistic hash) and its SOPS-encrypted secrets;
 * the org-level mutations save / test / remove THIS organization's
 * object-storage connection. Each save/delete invalidates its matching read so
 * the form re-baselines from disk truth.
 */

function useInvalidateDeployment() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ['config', 'deployment'] });
}

/** Persist the deployment config (validated + optimistic-hash on the server). */
export function useSaveDeploymentConfig() {
  const invalidate = useInvalidateDeployment();
  return useConvexAction(api.deployment.file_actions.saveDeploymentConfig, {
    onSuccess: () => invalidate(),
  });
}

/** Merge/persist deployment secrets (SOPS-encrypted server-side). */
export function useSaveDeploymentSecret() {
  const invalidate = useInvalidateDeployment();
  return useConvexAction(api.deployment.file_actions.saveDeploymentSecret, {
    onSuccess: () => invalidate(),
  });
}

/** Probe a candidate data-store connection before saving. */
export function useTestDeploymentConnection() {
  return useConvexAction(api.deployment.file_actions.testDeploymentConnection);
}

/** Ask the opt-in controller sidecar to restart convex (one-click apply). */
export function useRequestRestart() {
  return useConvexAction(api.deployment.file_actions.requestRestart);
}

function useInvalidateOrgObjectStorage(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'org-object-storage', organizationId],
    });
}

/** Persist the org's object-storage connection (+ optional credentials sidecar). */
export function useSaveOrgObjectStorageConnection(organizationId: string) {
  const invalidate = useInvalidateOrgObjectStorage(organizationId);
  return useConvexAction(
    api.object_storage.actions.saveObjectStorageConnection,
    { onSuccess: () => invalidate() },
  );
}

/** Remove the org's object-storage connection (revert to deployment storage). */
export function useDeleteOrgObjectStorageConnection(organizationId: string) {
  const invalidate = useInvalidateOrgObjectStorage(organizationId);
  return useConvexAction(
    api.object_storage.actions.deleteObjectStorageConnection,
    { onSuccess: () => invalidate() },
  );
}

/** Probe a candidate bucket with a real PUT+GET+DELETE round-trip. */
export function useTestOrgObjectStorageConnection() {
  return useConvexAction(
    api.object_storage.actions.testObjectStorageConnection,
  );
}
