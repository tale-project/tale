/**
 * Common Zod schema builders for form validation.
 * Provides reusable, translated validation schemas.
 */

import { z } from 'zod';

export type TranslationFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * Create an email validation schema with translated error message.
 */
export function createEmailSchema(t: TranslationFn, options?: { required?: boolean }) {
  const { required = true } = options ?? {};

  let schema = z.string();

  if (required) {
    schema = schema.min(1, t('validation.required', { field: t('form.email') }));
  }

  return schema.email(t('validation.email'));
}

/**
 * Create a name/display name validation schema with translated error message.
 */
export function createNameSchema(
  t: TranslationFn,
  options?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    fieldName?: string;
  }
) {
  const { required = false, minLength = 1, maxLength = 255, fieldName } = options ?? {};
  const field = fieldName || t('form.name');

  let schema = z.string();

  if (required) {
    schema = schema.min(minLength, t('validation.required', { field }));
  }

  if (maxLength) {
    schema = schema.max(maxLength, t('validation.maxLength', { field, max: maxLength }));
  }

  return schema;
}

/**
 * Create a locale validation schema.
 */
export function createLocaleSchema(options?: { defaultValue?: string }) {
  const { defaultValue = 'en' } = options ?? {};

  return z.string().default(defaultValue);
}

/**
 * Create a URL validation schema with translated error message.
 */
export function createUrlSchema(t: TranslationFn, options?: { required?: boolean }) {
  const { required = true } = options ?? {};

  let schema = z.string();

  if (required) {
    schema = schema.min(1, t('validation.required', { field: 'URL' }));
  }

  return schema.url(t('validation.url'));
}

/**
 * Create a password validation schema with configurable requirements.
 */
export function createPasswordSchema(
  t: TranslationFn,
  options?: {
    required?: boolean;
    minLength?: number;
    requireLowercase?: boolean;
    requireUppercase?: boolean;
    requireNumber?: boolean;
    requireSpecialChar?: boolean;
  }
) {
  const {
    required = true,
    minLength = 8,
    requireLowercase = true,
    requireUppercase = true,
    requireNumber = true,
    requireSpecialChar = false,
  } = options ?? {};

  let schema = z.string();

  if (required) {
    schema = schema.min(1, t('validation.required', { field: t('form.password') }));
  }

  return schema.refine(
    (val) => {
      if (!val && !required) return true;
      if (val.length < minLength) return false;
      if (requireLowercase && !/[a-z]/.test(val)) return false;
      if (requireUppercase && !/[A-Z]/.test(val)) return false;
      if (requireNumber && !/\d/.test(val)) return false;
      if (requireSpecialChar && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(val)) return false;
      return true;
    },
    { message: t('validation.passwordRequirements') }
  );
}

/**
 * Create an optional password schema for update forms.
 * Only validates if a value is provided.
 */
export function createOptionalPasswordSchema(
  t: TranslationFn,
  options?: {
    minLength?: number;
    requireLowercase?: boolean;
    requireUppercase?: boolean;
    requireNumber?: boolean;
    requireSpecialChar?: boolean;
  }
) {
  const {
    minLength = 8,
    requireLowercase = true,
    requireUppercase = true,
    requireNumber = true,
    requireSpecialChar = false,
  } = options ?? {};

  return z.string().optional().refine(
    (val) => {
      if (!val || val.length === 0) return true;
      if (val.length < minLength) return false;
      if (requireLowercase && !/[a-z]/.test(val)) return false;
      if (requireUppercase && !/[A-Z]/.test(val)) return false;
      if (requireNumber && !/\d/.test(val)) return false;
      if (requireSpecialChar && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(val)) return false;
      return true;
    },
    { message: t('validation.passwordRequirements') }
  );
}

/**
 * Create a file upload validation schema.
 */
export function createFileSchema(
  t: TranslationFn,
  options?: {
    required?: boolean;
    maxSize?: number;
    acceptedTypes?: string[];
  }
) {
  const { required = false, maxSize, acceptedTypes } = options ?? {};

  const baseSchema = z.instanceof(File);

  if (required) {
    return baseSchema.refine(
      (file) => {
        if (maxSize && file.size > maxSize) return false;
        if (acceptedTypes && acceptedTypes.length > 0) {
          const ext = file.name.split('.').pop()?.toLowerCase();
          return acceptedTypes.some((type) => type.toLowerCase() === `.${ext}`);
        }
        return true;
      },
      { message: t('validation.invalidFile') }
    );
  }

  return baseSchema.optional().refine(
    (file) => {
      if (!file) return true;
      if (maxSize && file.size > maxSize) return false;
      if (acceptedTypes && acceptedTypes.length > 0) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return acceptedTypes.some((type) => type.toLowerCase() === `.${ext}`);
      }
      return true;
    },
    { message: t('validation.invalidFile') }
  );
}

/**
 * Create a role selection schema.
 */
export function createRoleSchema(
  t: TranslationFn,
  roles: readonly string[] = ['admin', 'developer', 'editor', 'member', 'disabled']
) {
  return z.enum(roles as unknown as [string, ...string[]], {
    message: t('validation.required', { field: t('form.role') }),
  });
}

/**
 * Common schema presets for quick access.
 */
export const schemaPresets = {
  /**
   * Standard email schema factory.
   */
  email: (t: TranslationFn) => createEmailSchema(t),

  /**
   * Optional email schema factory.
   */
  optionalEmail: (t: TranslationFn) => createEmailSchema(t, { required: false }).optional(),

  /**
   * Standard name schema factory.
   */
  name: (t: TranslationFn) => createNameSchema(t),

  /**
   * Required name schema factory.
   */
  requiredName: (t: TranslationFn) => createNameSchema(t, { required: true }),

  /**
   * Standard locale schema.
   */
  locale: () => createLocaleSchema(),

  /**
   * Standard URL schema factory.
   */
  url: (t: TranslationFn) => createUrlSchema(t),

  /**
   * Standard password schema factory.
   */
  password: (t: TranslationFn) => createPasswordSchema(t),

  /**
   * Optional password schema factory.
   */
  optionalPassword: (t: TranslationFn) => createOptionalPasswordSchema(t),

  /**
   * Standard role schema factory.
   */
  role: (t: TranslationFn) => createRoleSchema(t),
};
