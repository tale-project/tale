import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

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
