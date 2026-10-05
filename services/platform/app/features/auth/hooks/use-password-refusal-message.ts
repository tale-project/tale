import { useCallback } from 'react';

import type { PasswordRefusal } from '@/app/lib/auth/password-refusal';
import { useT } from '@/lib/i18n/client';

import { useLockoutMessage } from './use-lockout-message';

/**
 * The sentence for a refused password confirmation: a wrong password, with
 * the warning that repeated ones lock the account, or the lock itself and
 * how long it lasts. Every prompt that asks a signed-in person for their
 * password words its refusals this way.
 */
export function usePasswordRefusalMessage(): (
  refusal: PasswordRefusal,
) => string {
  const { t } = useT('twoFactor');
  const lockoutMessage = useLockoutMessage();
  return useCallback(
    (refusal: PasswordRefusal): string =>
      refusal.reason === 'locked'
        ? lockoutMessage(refusal.retryAfterSec)
        : t('confirmPassword.wrongPassword'),
    [t, lockoutMessage],
  );
}
