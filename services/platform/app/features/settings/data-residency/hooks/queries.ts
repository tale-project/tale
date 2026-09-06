import { useActionQuery } from '@/app/hooks/use-action-query';
import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * Read hooks for the unified data-residency page. The reads are ACTIONS (they
 * read the per-org JSON connection files off disk), so they go through
 * `useActionQuery` rather than `useBackendQuery`.
 */

/** The org's object-storage connection (masked — never carries credentials). */
export function useOrgObjectStorageConnection(organizationId: string) {
  return useActionQuery(
    ['config', 'org-object-storage', organizationId],
    'object_storage/actions:getObjectStorageConnection',
    { organizationId },
  );
}

/** The org's knowledge-DB connection (masked — never carries the password). */
export function useOrgKnowledgeConnection(organizationId: string) {
  return useActionQuery(
    ['config', 'org-knowledge', organizationId],
    'knowledge/actions:getKnowledgeConnection',
    { organizationId },
  );
}

/** The org's embedding model config (nothing secret in it). */
export function useOrgKnowledgeEmbedding(organizationId: string) {
  return useActionQuery(
    ['config', 'org-embedding', organizationId],
    'knowledge/actions:getKnowledgeEmbedding',
    { organizationId },
  );
}

/**
 * Embedding models the org could adopt — curated picks from the catalogs its
 * direct credentials already unlock, each carrying the vector width an admin
 * would otherwise have to look up by hand. Feeds the one-click form fill in
 * the embedding section; the admin's Save remains the write.
 */
export function useEmbeddingRecommendations(
  organizationId: string,
  options?: { enabled?: boolean },
) {
  return useActionQuery(
    ['config', 'org-embedding-recommendations', organizationId],
    'knowledge/recommendations:listEmbeddingRecommendations',
    { organizationId },
    options,
  );
}

/**
 * The latest blob-backfill run of this org, or null. A reactive Convex query —
 * progress streams in without polling. The server gates it to `write
 * orgSettings` (it THROWS for plain members), so callers must pass
 * `canView: false` to skip it rather than merely hiding the result.
 */
export function useObjectStorageBackfillStatus(
  organizationId: string,
  canView: boolean,
) {
  return useBackendQuery(
    'object_storage/backfill_queries:getObjectStorageBackfillStatus',
    canView ? { organizationId } : 'skip',
  );
}
