import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useSetMemberPassword() {
  return useBackendMutation('users/mutations:setMemberPassword');
}

export function useCreateMember() {
  // The add dialog reports a failure itself: a member already there or a
  // missing password under its field, anything else in its own toast.
  return useBackendMutation('users/mutations:createMember', {
    errorToast: false,
  });
}

/** The members table's bulk remove passes `errorToast: false`: its
 * `BulkDeleteBar` raises one toast for the batch, with the first refusal's
 * words. The single-member remove dialog keeps the default toast. */
export function useRemoveMember(options?: { errorToast?: false }) {
  return useBackendMutation('members/mutations:removeMember', options);
}

export function useUpdateMemberRole() {
  return useBackendMutation('members/mutations:updateMemberRole');
}

export function useUpdateMemberDisplayName() {
  return useBackendMutation('members/mutations:updateMemberDisplayName');
}

export function useTransferOwnership() {
  return useBackendMutation('members/mutations:transferOwnership');
}

export function useResetMemberTwoFactor() {
  return useBackendMutation('two_factor/mutations:resetForUser');
}

export function useRevokeMemberPasskey() {
  return useBackendMutation('two_factor/mutations:revokePasskeyForMember');
}
