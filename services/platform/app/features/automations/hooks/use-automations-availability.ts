import { useBackendQuery } from '@/app/hooks/use-backend-query';

/**
 * Whether the Automations section holds anything for someone who cannot
 * build automations: at least one DEPLOYED organization automation — one
 * bound to no project, since a project-bound automation already shows on its
 * project's own tab. Only Owners, Admins and Developers author automations,
 * so for everyone else a section of seeded, undeployed packages is clutter
 * they cannot act on.
 *
 * Ask the server for organization-wide automations: the all-projects listing
 * hides unreadable project IDs, so an empty returned `projectIds` array alone
 * cannot establish that an automation is unbound.
 */
export function useAutomationsAvailability(organizationId: string): {
  isLoading: boolean;
  hasLiveOrgAutomation: boolean;
} {
  const { data, isLoading } = useBackendQuery(
    'automations/queries:listAutomations',
    organizationId ? { organizationId } : 'skip',
  );
  return {
    isLoading,
    hasLiveOrgAutomation: (data ?? []).some(
      (row) =>
        row.deployedVersion !== undefined &&
        (row.projectIds ?? []).length === 0,
    ),
  };
}
