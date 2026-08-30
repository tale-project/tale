import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useCreateTeamMember() {
  return useBackendMutation('team_members/mutations:addMember');
}

export function useAddTeamMember() {
  return useBackendMutation('team_members/mutations:addMember');
}

export function useRemoveTeamMember() {
  return useBackendMutation('team_members/mutations:removeMember');
}
