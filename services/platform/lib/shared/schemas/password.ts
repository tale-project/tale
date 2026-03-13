import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_RULES = {
  minLength: PASSWORD_MIN_LENGTH,
  lowercase: /[a-z]/,
  uppercase: /[A-Z]/,
  number: /\d/,
  specialChar: /[!@#$%^&*(),.?":{}|<>]/,
} as const;

/**
 * Validates a password string against all password policy rules.
 * Returns an object indicating which rules pass/fail.
 */
export function validatePassword(password: string) {
  return {
    length: password.length >= PASSWORD_RULES.minLength,
    lowercase: PASSWORD_RULES.lowercase.test(password),
    uppercase: PASSWORD_RULES.uppercase.test(password),
    number: PASSWORD_RULES.number.test(password),
    specialChar: PASSWORD_RULES.specialChar.test(password),
  };
}

/**
 * Returns true if the password meets all policy requirements.
 */
export function isPasswordValid(password: string) {
  const result = validatePassword(password);
  return Object.values(result).every(Boolean);
}

interface PasswordValidationMessages {
  minLength: string;
  lowercase: string;
  uppercase: string;
  number: string;
  specialChar: string;
}

/**
 * Creates a Zod password schema with translated error messages.
 * Enforces all 5 password rules: min length, lowercase, uppercase, number, special char.
 */
export function createPasswordSchema(messages: PasswordValidationMessages) {
  return z
    .string()
    .min(PASSWORD_RULES.minLength, messages.minLength)
    .regex(PASSWORD_RULES.lowercase, messages.lowercase)
    .regex(PASSWORD_RULES.uppercase, messages.uppercase)
    .regex(PASSWORD_RULES.number, messages.number)
    .regex(PASSWORD_RULES.specialChar, messages.specialChar);
}

/**
 * Creates an optional Zod password schema for forms where password is not required.
 * Empty/missing values pass; non-empty values must meet all password rules.
 */
export function createOptionalPasswordSchema(
  messages: PasswordValidationMessages,
) {
  return z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val.length === 0) return true;
        return isPasswordValid(val);
      },
      { message: messages.minLength },
    );
}
