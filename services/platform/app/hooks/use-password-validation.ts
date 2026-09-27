import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from '@tale/shared/schemas/governance';
import { useMemo } from 'react';
import { z } from 'zod';

import { useT } from '@/lib/i18n/client';
import {
  createPasswordSchema,
  enabledValidationKeys,
  validatePassword,
} from '@/lib/shared/schemas/password';

/**
 * Returns password validation check items for use with `ValidationCheckList`.
 * Only includes items for rules enabled by the supplied policy — disabled
 * rules are omitted entirely so the checklist never shows a "passing"
 * row for a constraint that doesn't apply. `null` (the rules are not known
 * yet, or could not be read) yields no items at all.
 */
export function usePasswordValidation(
  password: string,
  policy: PasswordPolicyConfig | null = DEFAULT_PASSWORD_POLICY,
) {
  const { t: tAuth } = useT('auth');

  return useMemo(() => {
    if (policy === null) return [];
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

/**
 * The new-password field's schema for a form whose write the server holds
 * to a policy: exactly that policy's rules once they are known. `null`
 * (still loading, or the read failed) asks only for a value and leaves the
 * verdict to the server, rather than guessing with the built-in default.
 */
export function useNewPasswordSchema(policy: PasswordPolicyConfig | null) {
  const { t: tAuth } = useT('auth');

  return useMemo(
    () =>
      policy === null
        ? z.string().min(1, tAuth('changePassword.validation.newRequired'))
        : createPasswordSchema(
            {
              minLength: tAuth('validation.passwordMinLength', {
                n: policy.minLength,
              }),
              lowercase: tAuth('validation.passwordLowercase'),
              uppercase: tAuth('validation.passwordUppercase'),
              number: tAuth('validation.passwordNumber'),
              specialChar: tAuth('validation.passwordSpecial'),
            },
            policy,
          ),
    [policy, tAuth],
  );
}
