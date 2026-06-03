import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

/**
 * Read the deployment-level config + masked secret presence + the per-caller
 * `canEdit` flag. Deployment-scoped (no org arg). Gated server-side on
 * instance-admin; `canEdit` (caller's email ∈ the editor allowlist) drives
 * edit-vs-read-only in the UI.
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
