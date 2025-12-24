'use client';

/**
 * i18n Client Abstraction
 *
 * Provides a wrapper around next-intl's useTranslations hook.
 * This abstraction layer allows easy migration to another i18n library
 * by only changing this file.
 *
 * @example
 * ```tsx
 * import { useT } from '@/lib/i18n';
 *
 * function MyComponent() {
 *   const { t } = useT('common');
 *   return <button>{t('actions.save')}</button>;
 * }
 * ```
 */

import { useTranslations, useLocale as useNextIntlLocale } from 'next-intl';
import type { Namespace } from './types';

/**
 * Hook for accessing translations in client components.
 *
 * @param namespace - The translation namespace to use
 * @returns Object containing the translation function
 */
export function useT<N extends Namespace>(namespace: N) {
  const t = useTranslations(namespace);
  return { t };
}

/**
 * Hook for accessing the current locale in client components.
 *
 * @returns The current locale string
 */
export function useLocale() {
  return useNextIntlLocale();
}

// Re-export for convenience
export { useT as useTranslations };
