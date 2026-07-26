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

/**
 * Kick off the blob backfill (move pre-existing built-in-storage blobs into
 * the org's bucket). No invalidation — progress arrives through the reactive
 * `useObjectStorageBackfillStatus` query.
 */
export function useStartObjectStorageBackfill() {
  return useConvexAction(
    api.object_storage.actions.startObjectStorageBlobBackfill,
  );
}

function useInvalidateOrgKnowledge(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'org-knowledge', organizationId],
    });
}

/** Persist the org's knowledge-DB connection (+ optional password sidecar). */
export function useSaveOrgKnowledgeConnection(organizationId: string) {
  const invalidate = useInvalidateOrgKnowledge(organizationId);
  return useConvexAction(api.knowledge.actions.saveKnowledgeConnection, {
    onSuccess: () => invalidate(),
  });
}

/** Remove the org's knowledge-DB connection (revert to the deployment DB). */
export function useDeleteOrgKnowledgeConnection(organizationId: string) {
  const invalidate = useInvalidateOrgKnowledge(organizationId);
  return useConvexAction(api.knowledge.actions.deleteKnowledgeConnection, {
    onSuccess: () => invalidate(),
  });
}

/** Probe a candidate knowledge Postgres (pgvector/ParadeDB availability). */
export function useTestOrgKnowledgeConnection() {
  return useConvexAction(api.knowledge.actions.testKnowledgeConnection);
}

function useInvalidateOrgEmbedding(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: ['config', 'org-embedding', organizationId],
    });
}

/** Persist the org's embedding model config. */
export function useSaveOrgKnowledgeEmbedding(organizationId: string) {
  const invalidate = useInvalidateOrgEmbedding(organizationId);
  return useConvexAction(api.knowledge.actions.saveKnowledgeEmbedding, {
    onSuccess: () => invalidate(),
  });
}

/** Remove the org's embedding config (knowledge search then refuses again). */
export function useDeleteOrgKnowledgeEmbedding(organizationId: string) {
  const invalidate = useInvalidateOrgEmbedding(organizationId);
  return useConvexAction(api.knowledge.actions.deleteKnowledgeEmbedding, {
    onSuccess: () => invalidate(),
  });
}
