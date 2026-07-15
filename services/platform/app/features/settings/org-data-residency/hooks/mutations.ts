import { useQueryClient } from '@tanstack/react-query';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Write hooks for the org-level data-residency panel — save / test / remove of
 * the per-org knowledge-DB and object-storage connections. Saves and deletes
 * invalidate the matching read so the form re-baselines from disk truth
 * (mirrors the deployment-level hooks).
 */

function useInvalidateOrgKnowledge(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'org-knowledge', organizationId],
    });
}

function useInvalidateOrgObjectStorage(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'org-object-storage', organizationId],
    });
}

/** Persist the org's knowledge-DB connection (+ optional password sidecar). */
export function useSaveOrgKnowledgeConnection(organizationId: string) {
  const invalidate = useInvalidateOrgKnowledge(organizationId);
  return useConvexAction(api.knowledge.actions.saveKnowledgeConnection, {
    onSuccess: () => invalidate(),
  });
}

/** Remove the org's knowledge-DB connection (revert to the deployment default). */
export function useDeleteOrgKnowledgeConnection(organizationId: string) {
  const invalidate = useInvalidateOrgKnowledge(organizationId);
  return useConvexAction(api.knowledge.actions.deleteKnowledgeConnection, {
    onSuccess: () => invalidate(),
  });
}

/** Probe a candidate knowledge Postgres (reachability + pgvector/ParadeDB). */
export function useTestOrgKnowledgeConnection() {
  return useConvexAction(api.knowledge.actions.testKnowledgeConnection);
}

/** Persist the org's object-storage connection (+ optional credentials sidecar). */
export function useSaveOrgObjectStorageConnection(organizationId: string) {
  const invalidate = useInvalidateOrgObjectStorage(organizationId);
  return useConvexAction(
    api.object_storage.actions.saveObjectStorageConnection,
    { onSuccess: () => invalidate() },
  );
}

/** Remove the org's object-storage connection (revert to Convex storage). */
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
