import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateTeamMember() {
  return useConvexMutation(api.team_members.mutations.addMember);
}

export function useAddTeamMember() {
  return useConvexMutation(api.team_members.mutations.addMember);
}

export function useRemoveTeamMember() {
  return useConvexMutation(api.team_members.mutations.removeMember);
}
