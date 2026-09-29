import { useQueryClient } from '@tanstack/react-query';

import { useBackendAction } from '@/app/hooks/use-backend-action';

/**
 * Write hooks for the unified data-residency page.
 *
 * Every mutation is org-level: save / test / remove THIS organization's
 * knowledge connection, embedding model, and object-storage connection. Each
 * save/delete invalidates its matching read so the form re-baselines from disk
 * truth.
 *
 * The saves, removals and the backfill start report a failure once, through
 * the page: a section's `save` rethrows it as `mapOrgResidencyError`'s
 * sentence for the Save cluster's toast, and a removal or the backfill toasts
 * that sentence itself. Their default toast would report it a second time,
 * so they opt out.
 */

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
  return useBackendAction(
    'object_storage/actions:saveObjectStorageConnection',
    {
      errorToast: false,
      onSuccess: () => invalidate(),
    },
  );
}

/** Remove the org's object-storage connection (revert to deployment storage). */
export function useDeleteOrgObjectStorageConnection(organizationId: string) {
  const invalidate = useInvalidateOrgObjectStorage(organizationId);
  return useBackendAction(
    'object_storage/actions:deleteObjectStorageConnection',
    { errorToast: false, onSuccess: () => invalidate() },
  );
}

/** Probe a candidate bucket with a real PUT+GET+DELETE round-trip. */
export function useTestOrgObjectStorageConnection() {
  return useBackendAction('object_storage/actions:testObjectStorageConnection');
}

/**
 * Kick off the blob backfill (move pre-existing built-in-storage blobs into
 * the org's bucket). No invalidation — progress arrives through the reactive
 * `useObjectStorageBackfillStatus` query.
 */
export function useStartObjectStorageBackfill() {
  return useBackendAction(
    'object_storage/actions:startObjectStorageBlobBackfill',
    { errorToast: false },
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
  return useBackendAction('knowledge/actions:saveKnowledgeConnection', {
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}

/** Remove the org's knowledge-DB connection (revert to the deployment DB). */
export function useDeleteOrgKnowledgeConnection(organizationId: string) {
  const invalidate = useInvalidateOrgKnowledge(organizationId);
  return useBackendAction('knowledge/actions:deleteKnowledgeConnection', {
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}

/** Probe a candidate knowledge Postgres (pgvector/ParadeDB availability). */
export function useTestOrgKnowledgeConnection() {
  return useBackendAction('knowledge/actions:testKnowledgeConnection');
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
  return useBackendAction('knowledge/actions:saveKnowledgeEmbedding', {
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}

/** Remove the org's embedding config (knowledge search then refuses again). */
export function useDeleteOrgKnowledgeEmbedding(organizationId: string) {
  const invalidate = useInvalidateOrgEmbedding(organizationId);
  return useBackendAction('knowledge/actions:deleteKnowledgeEmbedding', {
    errorToast: false,
    onSuccess: () => invalidate(),
  });
}
