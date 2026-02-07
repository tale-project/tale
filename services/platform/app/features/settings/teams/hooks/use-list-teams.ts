'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';

export interface Team {
  id: string;
  name: string;
}

/**
 * Hook to get teams for the current user.
 *
 * In trusted headers mode, teams come from JWT claims (trustedTeams).
 * In normal auth mode, teams come from the teamMember database table.
 */
export function useListTeams(organizationId: string | undefined) {
  const result = useQuery(
    api.members.queries.getMyTeams,
    organizationId ? { organizationId } : 'skip',
  );

  return {
    teams: result?.teams ?? null,
    isLoading: result === undefined,
    /** True if teams are managed by external IdP (trusted headers mode) */
    isExternallyManaged: false,
  };
}
