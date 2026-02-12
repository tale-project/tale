import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { TeamMember } from '@/lib/collections/entities/team-members';

export function useRemoveTeamMember(
  collection: Collection<TeamMember, string>,
) {
  return useCallback(
    async (args: { teamMemberId: string; organizationId: string }) => {
      const tx = collection.delete(args.teamMemberId, {
        metadata: { organizationId: args.organizationId },
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
