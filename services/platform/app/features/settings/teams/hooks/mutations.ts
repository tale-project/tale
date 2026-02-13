import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { TeamMember } from '@/lib/collections/entities/team-members';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateTeamMember() {
  return useConvexMutation(api.team_members.mutations.addMember);
}

export function useAddTeamMember(collection: Collection<TeamMember, string>) {
  return useCallback(
    async (args: {
      teamId: string;
      userId: string;
      organizationId: string;
    }) => {
      const tx = collection.insert(
        {
          _id: `temp-${crypto.randomUUID()}`,
          teamId: args.teamId,
          userId: args.userId,
          role: 'member',
          joinedAt: Date.now(),
          displayName: undefined,
          email: undefined,
        },
        {
          optimistic: false,
          metadata: { organizationId: args.organizationId },
        },
      );
      await tx.isPersisted.promise;
    },
    [collection],
  );
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
