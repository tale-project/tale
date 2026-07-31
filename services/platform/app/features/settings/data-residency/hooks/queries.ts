import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * Read hooks for the unified data-residency page. Both reads are Convex
 * ACTIONS (they read config off disk — the deployment config file and the
 * per-org JSON connection files), so they go through `useActionQuery` rather
 * than `useConvexQuery`.
 *
 * Read the deployment-level config + masked secret presence + the per-caller
 * `canEdit` flag. Deployment-scoped (no org arg). The read is open to any
 * organization admin (`read orgSettings`) so they can VIEW where deployment
 * data lives; `canEdit` (caller's email ∈ the `TALE_DEPLOYMENT_CONFIG_ADMINS`
 * allowlist) is what drives edit-vs-read-only in the UI.
 *
 * NOTE: `api.deployment.*` is populated by `convex codegen` — run dev/deploy
 * after pulling this branch so the generated API includes the deployment module.
 */
export function useReadDeploymentConfig(options?: { enabled?: boolean }) {
  return useActionQuery(
    ['config', 'deployment'],
    api.deployment.file_actions.readDeploymentConfig,
    {},
    options,
  );
}

/** The org's object-storage connection (masked — never carries credentials). */
export function useOrgObjectStorageConnection(organizationId: string) {
  return useActionQuery(
    ['config', 'org-object-storage', organizationId],
    api.object_storage.actions.getObjectStorageConnection,
    { organizationId },
  );
}

/** The org's knowledge-DB connection (masked — never carries the password). */
export function useOrgKnowledgeConnection(organizationId: string) {
  return useActionQuery(
    ['config', 'org-knowledge', organizationId],
    api.knowledge.actions.getKnowledgeConnection,
    { organizationId },
  );
}

/** The org's embedding model config (nothing secret in it). */
export function useOrgKnowledgeEmbedding(organizationId: string) {
  return useActionQuery(
    ['config', 'org-embedding', organizationId],
    api.knowledge.actions.getKnowledgeEmbedding,
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
    api.knowledge.recommendations.listEmbeddingRecommendations,
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
  return useConvexQuery(
    api.object_storage.backfill_queries.getObjectStorageBackfillStatus,
    canView ? { organizationId } : 'skip',
  );
}
