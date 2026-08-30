import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useCreateTeamMember() {
  return useConvexMutation('team_members/mutations:addMember');
}

export function useAddTeamMember() {
  return useConvexMutation('team_members/mutations:addMember');
}

export function useRemoveTeamMember() {
  return useConvexMutation('team_members/mutations:removeMember');
}
