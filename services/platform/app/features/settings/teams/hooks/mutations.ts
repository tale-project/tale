import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

// Every caller of these writes reports a failure in its own toast, under its
// own title: the create and edit dialogs one toast for the whole save, the
// delete dialog and the teams table's bulk delete one for the delete. The
// hook's default toast would report the same failure again, once per call.

export function useCreateTeamMember() {
  return useBackendMutation('team_members/mutations:addMember', {
    errorToast: false,
  });
}

export function useAddTeamMember() {
  return useBackendMutation('team_members/mutations:addMember', {
    errorToast: false,
  });
}

export function useRemoveTeamMember() {
  return useBackendMutation('team_members/mutations:removeMember', {
    errorToast: false,
  });
}

/** The atomic team delete (scopes, provenance, members and the row in one
 * transaction) — the one door every delete gesture in the UI uses. */
export function useDeleteTeam() {
  return useBackendMutation('teams/mutations:deleteTeam', {
    errorToast: false,
  });
}
