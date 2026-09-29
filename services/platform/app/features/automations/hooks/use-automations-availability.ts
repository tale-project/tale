import { useBackendQuery } from '@/app/hooks/use-backend-query';

import { isLiveAutomation } from '../lib/reader-listing';

/**
 * Whether the Automations section holds anything for someone who cannot
 * build automations: at least one DEPLOYED organization automation — one
 * bound to no project, since a project-bound automation already shows on its
 * project's own tab. Only Owners, Admins and Developers author automations,
 * so for everyone else a section of seeded, undeployed packages is clutter
 * they cannot act on.
 *
 * Reads the same all-projects listing the Inbox availability check, the org
 * Automations list and its route loader already hold, so the rail costs no
 * request of its own; an unbound automation is one whose `projectIds` is
 * empty. Pass an empty `organizationId` to skip the read — authors see the
 * section regardless, so they never need the answer.
 */
export function useAutomationsAvailability(organizationId: string): {
  isLoading: boolean;
  hasLiveOrgAutomation: boolean;
} {
  const { data, isLoading } = useBackendQuery(
    'automations/queries:listAutomations',
    organizationId ? { organizationId, includeProjectBound: true } : 'skip',
  );
  return {
    isLoading,
    hasLiveOrgAutomation: (data ?? []).some(
      (row) => isLiveAutomation(row) && row.projectIds.length === 0,
    ),
  };
}
