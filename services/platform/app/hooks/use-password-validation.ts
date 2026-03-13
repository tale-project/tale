import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { validatePassword } from '@/lib/shared/schemas/password';

/**
 * Returns password validation check items for use with `ValidationCheckList`.
 * Provides consistent password requirement display across all forms.
 */
export function usePasswordValidation(password: string) {
  const { t: tAuth } = useT('auth');

  return useMemo(() => {
    const result = validatePassword(password);
    return [
      {
        isValid: result.length,
        message: tAuth('changePassword.requirements.length'),
      },
      {
        isValid: result.lowercase,
        message: tAuth('changePassword.requirements.lowercase'),
      },
      {
        isValid: result.uppercase,
        message: tAuth('changePassword.requirements.uppercase'),
      },
      {
        isValid: result.number,
        message: tAuth('changePassword.requirements.number'),
      },
      {
        isValid: result.specialChar,
        message: tAuth('changePassword.requirements.specialChar'),
      },
    ];
  }, [password, tAuth]);
}
