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

/** The atomic team delete (scopes, provenance, members and the row in one
 * transaction) — the one door every delete gesture in the UI uses. */
export function useDeleteTeam() {
  return useBackendMutation('teams/mutations:deleteTeam');
}
