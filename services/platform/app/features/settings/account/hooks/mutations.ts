import { useQueryClient } from '@tanstack/react-query';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { passwordExpiryQuery } from '@/app/lib/backend/account';

export function useUpdateUserName() {
  return useBackendMutation('users/mutations:updateUserName');
}

export function useUpdatePassword() {
  const queryClient = useQueryClient();
  return useBackendMutation('users/mutations:updateUserPassword', {
    // The forced-change page navigates as soon as this mutation resolves.
    // Refresh its shared gate first so the dashboard cannot reuse expired:true.
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: passwordExpiryQuery().queryKey,
      }),
  });
}
