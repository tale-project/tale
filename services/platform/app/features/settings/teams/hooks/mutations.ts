import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { TeamMember } from '@/lib/collections/entities/team-members';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useAddTeamMember() {
  return useConvexMutation(api.team_members.mutations.addMember);
}

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
