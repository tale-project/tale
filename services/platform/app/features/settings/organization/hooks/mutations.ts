import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useSetMemberPassword() {
  return useBackendMutation('users/mutations:setMemberPassword');
}

export function useCreateMember() {
  return useBackendMutation('users/mutations:createMember');
}

export function useRemoveMember() {
  return useBackendMutation('members/mutations:removeMember');
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
