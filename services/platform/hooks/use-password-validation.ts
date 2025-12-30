'use client';

import { useMemo } from 'react';

export interface PasswordValidation {
  /** Whether the password meets minimum length requirement */
  hasMinLength: boolean;
  /** Whether the password contains at least one lowercase letter */
  hasLowercase: boolean;
  /** Whether the password contains at least one uppercase letter */
  hasUppercase: boolean;
  /** Whether the password contains at least one number */
  hasNumber: boolean;
  /** Whether the password contains at least one special character */
  hasSpecialChar: boolean;
  /** Whether all required validations pass */
  isValid: boolean;
}

export interface PasswordValidationOptions {
  /** Minimum password length (default: 8) */
  minLength?: number;
  /** Whether to require lowercase letters (default: true) */
  requireLowercase?: boolean;
  /** Whether to require uppercase letters (default: true) */
  requireUppercase?: boolean;
  /** Whether to require numbers (default: true) */
  requireNumber?: boolean;
  /** Whether to require special characters (default: false) */
  requireSpecialChar?: boolean;
}

/**
 * Default password validation options.
 */
const defaultOptions: Required<PasswordValidationOptions> = {
  minLength: 8,
  requireLowercase: true,
  requireUppercase: true,
  requireNumber: true,
  requireSpecialChar: false,
};

/**
 * Hook for validating password strength.
 * Returns an object with individual validation states and overall validity.
 *
 * @example
 * ```tsx
 * const password = watch('password');
 * const validation = usePasswordValidation(password);
 *
 * // Use with ValidationCheckList
 * const items = [
 *   { isValid: validation.hasMinLength, message: t('requirements.length') },
 *   { isValid: validation.hasLowercase, message: t('requirements.lowercase') },
 *   { isValid: validation.hasUppercase, message: t('requirements.uppercase') },
 *   { isValid: validation.hasNumber, message: t('requirements.number') },
 * ];
 * ```
 */
export function usePasswordValidation(
  password: string | undefined,
  options: PasswordValidationOptions = {}
): PasswordValidation {
  const mergedOptions = { ...defaultOptions, ...options };

  return useMemo(() => {
    const pwd = password ?? '';

    const hasMinLength = pwd.length >= mergedOptions.minLength;
    const hasLowercase = /[a-z]/.test(pwd);
    const hasUppercase = /[A-Z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);
    const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd);

    // Determine validity based on required options
    const isValid =
      hasMinLength &&
      (!mergedOptions.requireLowercase || hasLowercase) &&
      (!mergedOptions.requireUppercase || hasUppercase) &&
      (!mergedOptions.requireNumber || hasNumber) &&
      (!mergedOptions.requireSpecialChar || hasSpecialChar);

    return {
      hasMinLength,
      hasLowercase,
      hasUppercase,
      hasNumber,
      hasSpecialChar,
      isValid,
    };
  }, [
    password,
    mergedOptions.minLength,
    mergedOptions.requireLowercase,
    mergedOptions.requireUppercase,
    mergedOptions.requireNumber,
    mergedOptions.requireSpecialChar,
  ]);
}

/**
 * Validate a password string without React hooks.
 * Useful for Zod validation schemas.
 */
export function validatePassword(
  password: string | undefined,
  options: PasswordValidationOptions = {}
): boolean {
  const mergedOptions = { ...defaultOptions, ...options };
  const pwd = password ?? '';

  const hasMinLength = pwd.length >= mergedOptions.minLength;
  const hasLowercase = /[a-z]/.test(pwd);
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasNumber = /\d/.test(pwd);
  const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd);

  return (
    hasMinLength &&
    (!mergedOptions.requireLowercase || hasLowercase) &&
    (!mergedOptions.requireUppercase || hasUppercase) &&
    (!mergedOptions.requireNumber || hasNumber) &&
    (!mergedOptions.requireSpecialChar || hasSpecialChar)
  );
}

/**
 * Create password validation items for use with ValidationCheckList.
 * Requires translation function to be passed for i18n support.
 */
export function createPasswordValidationItems(
  validation: PasswordValidation,
  translations: {
    length: string;
    lowercase: string;
    uppercase: string;
    number: string;
    specialChar?: string;
  }
): Array<{ isValid: boolean; message: string }> {
  return [
    { isValid: validation.hasMinLength, message: translations.length },
    { isValid: validation.hasLowercase, message: translations.lowercase },
    { isValid: validation.hasUppercase, message: translations.uppercase },
    { isValid: validation.hasNumber, message: translations.number },
    ...(translations.specialChar
      ? [
          {
            isValid: validation.hasSpecialChar,
            message: translations.specialChar,
          },
        ]
      : []),
  ];
}
