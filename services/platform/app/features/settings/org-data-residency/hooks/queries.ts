import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Read hooks for the org-level data-residency panel. Both reads are Convex
 * ACTIONS (they read per-org JSON config files from disk), so they go through
 * `useActionQuery` rather than `useConvexQuery` — same idiom as the
 * deployment-level `useReadDeploymentConfig`.
 *
 * `api.knowledge.actions` / `api.object_storage.actions` are populated by
 * `convex codegen` — run dev/deploy after pulling this branch so the generated
 * API includes both modules.
 */

/** The org's knowledge-DB connection (masked — never carries the password). */
export function useOrgKnowledgeConnection(organizationId: string) {
  return useActionQuery(
    ['config', 'org-knowledge', organizationId],
    api.knowledge.actions.getKnowledgeConnection,
    { organizationId },
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
