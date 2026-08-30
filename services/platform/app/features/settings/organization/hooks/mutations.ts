import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useSetMemberPassword() {
  return useConvexMutation('users/mutations:setMemberPassword');
}

export function useCreateMember() {
  return useConvexMutation('users/mutations:createMember');
}

export function useRemoveMember() {
  return useConvexMutation('members/mutations:removeMember');
}

export function useUpdateMemberRole() {
  return useConvexMutation('members/mutations:updateMemberRole');
}

export function useUpdateMemberDisplayName() {
  return useConvexMutation('members/mutations:updateMemberDisplayName');
}

export function useTransferOwnership() {
  return useConvexMutation('members/mutations:transferOwnership');
}

export function useResetMemberTwoFactor() {
  return useConvexMutation('two_factor/mutations:resetForUser');
}

export function useRevokeMemberPasskey() {
  return useConvexMutation('two_factor/mutations:revokePasskeyForMember');
}
