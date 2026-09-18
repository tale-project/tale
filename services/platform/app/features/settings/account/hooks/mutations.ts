import { useQueryClient } from '@tanstack/react-query';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { passwordExpiryQuery } from '@/app/lib/backend/account';

export function useUpdateUserName() {
  return useBackendMutation('users/mutations:updateUserName');
}

export function useUpdatePassword() {
  const queryClient = useQueryClient();
  return useBackendMutation('users/mutations:updateUserPassword', {
    // The forced-change page navigates the moment this resolves, and the
    // dashboard gate redirects straight back on a cached `expired: true`.
    // The write answers the recomputed status, so publish it rather than
    // re-read: a re-read that fails leaves the stale `expired: true` in
    // place and bounces the user onto the wall they just cleared, password
    // already changed. Only a backend that predates the field answers null.
    onSuccess: async (status) => {
      if (!status) {
        await queryClient.invalidateQueries({
          queryKey: passwordExpiryQuery().queryKey,
        });
        return;
      }
      queryClient.setQueryData(passwordExpiryQuery().queryKey, status);
    },
  });
}
