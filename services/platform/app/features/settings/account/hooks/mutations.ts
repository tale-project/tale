import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useUpdateUserName() {
  return useConvexMutation('users/mutations:updateUserName');
}

export function useUpdatePassword() {
  return useConvexMutation('users/mutations:updateUserPassword');
}
