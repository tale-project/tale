import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateTeamMember(teamId?: string) {
  return useConvexOptimisticMutation(
    api.team_members.mutations.addMember,
    api.team_members.queries.listByTeam,
    {
      queryArgs: teamId ? { teamId } : undefined,
      onMutate: ({ userId }, { insert }) =>
        insert({
          teamId: teamId ?? '',
          userId,
          role: 'member',
          joinedAt: Date.now(),
        }),
    },
  );
}

export function useAddTeamMember(teamId?: string) {
  return useConvexOptimisticMutation(
    api.team_members.mutations.addMember,
    api.team_members.queries.listByTeam,
    {
      queryArgs: teamId ? { teamId } : undefined,
      onMutate: ({ userId }, { insert }) =>
        insert({
          teamId: teamId ?? '',
          userId,
          role: 'member',
          joinedAt: Date.now(),
        }),
    },
  );
}

export function useRemoveTeamMember(teamId?: string) {
  return useConvexOptimisticMutation(
    api.team_members.mutations.removeMember,
    api.team_members.queries.listByTeam,
    {
      queryArgs: teamId ? { teamId } : undefined,
      onMutate: ({ teamMemberId }, { remove }) => remove(teamMemberId),
    },
  );
}
