import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateTeamMember() {
  return useConvexMutation(api.team_members.mutations.addMember);
}

export function useAddTeamMember() {
  const { mutateAsync } = useConvexMutation(
    api.team_members.mutations.addMember,
  );
  return mutateAsync;
}

export function useRemoveTeamMember() {
  const { mutateAsync } = useConvexMutation(
    api.team_members.mutations.removeMember,
  );
  return mutateAsync;
}
