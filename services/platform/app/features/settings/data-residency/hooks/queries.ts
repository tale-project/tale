import { useActionQuery } from '@/app/hooks/use-action-query';
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
