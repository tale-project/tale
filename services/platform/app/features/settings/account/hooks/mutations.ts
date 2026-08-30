import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useUpdateUserName() {
  return useBackendMutation('users/mutations:updateUserName');
}

export function useUpdatePassword() {
  return useBackendMutation('users/mutations:updateUserPassword');
}
