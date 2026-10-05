import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The sentence for a password check refused because the account is locked
 * (429), with the wait rounded to the largest whole unit. Shared by every
 * door that counts against the lockout: the log-in form and the password
 * confirmation before adding a passkey.
 */
export function useLockoutMessage(): (
  retryAfterSec: number | undefined,
) => string {
  const { t } = useT('auth');
  return useCallback(
    (retryAfterSec: number | undefined): string => {
      if (!retryAfterSec || retryAfterSec <= 0) {
        return t('login.accountLockedGeneric');
      }
      if (retryAfterSec < 60) {
        return t('login.accountLockedSeconds', { seconds: retryAfterSec });
      }
      const minutes = Math.ceil(retryAfterSec / 60);
      if (minutes < 60) {
        return t('login.accountLockedMinutes', { minutes });
      }
      const hours = Math.ceil(retryAfterSec / 3600);
      return t('login.accountLockedHours', { hours });
    },
    [t],
  );
}
