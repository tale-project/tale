import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '@/lib/shared/schemas/governance';
import {
  enabledValidationKeys,
  validatePassword,
} from '@/lib/shared/schemas/password';

/**
 * Returns password validation check items for use with `ValidationCheckList`.
 * Only includes items for rules enabled by the supplied policy — disabled
 * rules are omitted entirely so the checklist never shows a "passing"
 * row for a constraint that doesn't apply.
 */
export function usePasswordValidation(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
) {
  const { t: tAuth } = useT('auth');

  return useMemo(() => {
    const result = validatePassword(password, policy);
    const keys = enabledValidationKeys(policy);
    const labels: Record<keyof typeof result, string> = {
      length: tAuth('changePassword.requirements.length', {
        n: policy.minLength,
      }),
      lowercase: tAuth('changePassword.requirements.lowercase'),
      uppercase: tAuth('changePassword.requirements.uppercase'),
      number: tAuth('changePassword.requirements.number'),
      specialChar: tAuth('changePassword.requirements.specialChar'),
    };
    return keys.map((key) => ({
      isValid: result[key],
      message: labels[key],
    }));
  }, [password, policy, tAuth]);
}
