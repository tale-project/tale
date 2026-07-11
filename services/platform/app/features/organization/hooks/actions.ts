import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

/**
 * Derived provisioning status for an org: which scaffolded config domains the
 * org-create pipeline should have seeded but demonstrably didn't (a failed
 * `scaffoldNewOrganization`, e.g. node actions down at create time). The
 * server action is developer-settings gated — only enable this for roles
 * with `ability.can('read', 'developerSettings')`.
 */
export function useProvisioningStatus(organizationId: string, enabled = true) {
  return useActionQuery(
    ['org-provisioning-status', organizationId],
    api.organizations.actions.getProvisioningStatus,
    { organizationId },
    { enabled },
  );
}

/**
 * One-click repair for a half-provisioned org: re-runs the full org-create
 * scaffold idempotently (every domain, providers + governance included) and
 * re-schedules the post-scaffold provisioners. Existing user-authored config
 * survives — only still-empty domains are seeded.
 */
export function useRetryProvisioning() {
  return useConvexAction(api.organizations.actions.retryProvisioning);
}
