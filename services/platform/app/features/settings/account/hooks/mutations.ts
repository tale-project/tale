import { useQueryClient } from '@tanstack/react-query';

import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import {
  invalidateMyPasswordPolicy,
  passwordExpiryQuery,
} from '@/app/lib/backend/account';
import { backendRefusalDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

/** The profile name save. A submit the header's Save cluster does not run
 * (Enter in the field) has only this toast, so it names why the server
 * refused the save; a fault keeps the generic "try again". */
export function useUpdateUserName() {
  const { t } = useT('toast');
  return useBackendMutation('users/mutations:updateUserName', {
    errorToast: {
      title: t('error.profileUpdateFailed.title'),
      description: backendRefusalDetail,
    },
  });
}

/** The password write refused the new password under the user's effective
 * policy — the verdict the forms defer to whenever they had no rules. */
export function isPasswordPolicyViolation(error: unknown): boolean {
  return backendErrorCode(error) === 'password_policy_violation';
}

export function useUpdatePassword() {
  const queryClient = useQueryClient();
  return useBackendMutation('users/mutations:updateUserPassword', {
    // Every caller reports its own failure — inline on the field a refusal
    // names, or its own toast — so the generic toast would only repeat it.
    errorToast: false,
    // A refusal under the policy means the form checked other rules, or none
    // (the read was still loading or had failed): read them again, so the
    // checklist shows the ones the server applies.
    onError: (error) => {
      if (isPasswordPolicyViolation(error)) {
        invalidateMyPasswordPolicy(queryClient);
      }
    },
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
