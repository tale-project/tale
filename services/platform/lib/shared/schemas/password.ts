import { z } from 'zod';

import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicyConfig,
} from './governance';

const LOWERCASE_REGEX = /[a-z]/;
const UPPERCASE_REGEX = /[A-Z]/;
const NUMBER_REGEX = /\d/;
const SPECIAL_CHAR_REGEX = /[!@#$%^&*(),.?":{}|<>]/;

/**
 * Validates a password string against the supplied policy rules.
 * Returns a fixed-shape object; disabled rules evaluate to `true` so the
 * caller can render a consistent UI and filter on enabled rules separately.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
) {
  return {
    length: password.length >= policy.minLength,
    lowercase: !policy.requireLower || LOWERCASE_REGEX.test(password),
    uppercase: !policy.requireUpper || UPPERCASE_REGEX.test(password),
    number: !policy.requireDigit || NUMBER_REGEX.test(password),
    specialChar: !policy.requireSpecial || SPECIAL_CHAR_REGEX.test(password),
  };
}

/**
 * Returns true if the password meets all enabled policy requirements.
 */
export function isPasswordValid(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
) {
  const result = validatePassword(password, policy);
  return Object.values(result).every(Boolean);
}

export type PasswordValidationKey = keyof ReturnType<typeof validatePassword>;

/**
 * Returns the subset of rule keys that are enabled for the given policy —
 * used by the UI to render only the applicable checklist items.
 */
export function enabledValidationKeys(
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): PasswordValidationKey[] {
  const keys: PasswordValidationKey[] = ['length'];
  if (policy.requireLower) keys.push('lowercase');
  if (policy.requireUpper) keys.push('uppercase');
  if (policy.requireDigit) keys.push('number');
  if (policy.requireSpecial) keys.push('specialChar');
  return keys;
}

interface PasswordValidationMessages {
  minLength: string;
  lowercase: string;
  uppercase: string;
  number: string;
  specialChar: string;
}

/**
 * Creates a Zod password schema that enforces exactly the rules enabled
 * by the supplied policy (or the built-in defaults when omitted).
 */
export function createPasswordSchema(
  messages: PasswordValidationMessages,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
) {
  let schema = z.string().min(policy.minLength, messages.minLength);
  if (policy.requireLower) {
    schema = schema.regex(LOWERCASE_REGEX, messages.lowercase);
  }
  if (policy.requireUpper) {
    schema = schema.regex(UPPERCASE_REGEX, messages.uppercase);
  }
  if (policy.requireDigit) {
    schema = schema.regex(NUMBER_REGEX, messages.number);
  }
  if (policy.requireSpecial) {
    schema = schema.regex(SPECIAL_CHAR_REGEX, messages.specialChar);
  }
  return schema;
}

/**
 * Optional-password variant: empty/missing values pass; non-empty values
 * must satisfy the enabled rules from the policy.
 */
export function createOptionalPasswordSchema(
  messages: PasswordValidationMessages,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
) {
  return z
    .string()
    .optional()
    .superRefine((val, ctx) => {
      if (!val || val.length === 0) return;

      const result = validatePassword(val, policy);
      if (!result.length) {
        ctx.addIssue({ code: 'custom', message: messages.minLength });
      }
      if (!result.lowercase) {
        ctx.addIssue({ code: 'custom', message: messages.lowercase });
      }
      if (!result.uppercase) {
        ctx.addIssue({ code: 'custom', message: messages.uppercase });
      }
      if (!result.number) {
        ctx.addIssue({ code: 'custom', message: messages.number });
      }
      if (!result.specialChar) {
        ctx.addIssue({ code: 'custom', message: messages.specialChar });
      }
    });
}

/**
 * Returns the list of rule keys a password fails under the given policy.
 * Server-side helpers use this to return structured errors rather than
 * a single stringified message.
 */
export function passwordPolicyViolations(
  password: string,
  policy: PasswordPolicyConfig = DEFAULT_PASSWORD_POLICY,
): PasswordValidationKey[] {
  const result = validatePassword(password, policy);
  return (Object.entries(result) as [PasswordValidationKey, boolean][])
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
}
