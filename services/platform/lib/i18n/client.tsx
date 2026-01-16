'use client';

/**
 * i18n Client Abstraction
 *
 * Provides a wrapper for client-side translations.
 * This abstraction layer allows easy migration to another i18n library
 * by only changing this file.
 *
 * @example
 * ```tsx
 * import { useT } from '@/lib/i18n/client';
 *
 * function MyComponent() {
 *   const { t } = useT('common');
 *   return <button>{t('actions.save')}</button>;
 * }
 * ```
 */

import { useI18nContext, createTranslationFunction } from './i18n-provider';
import type { Namespace } from './types';

/**
 * Hook for accessing translations in client components.
 *
 * @param namespace - The translation namespace to use
 * @returns Object containing the translation function
 */
export function useT<N extends Namespace>(namespace: N) {
  const { messages } = useI18nContext();
  const t = createTranslationFunction(messages, namespace);
  return { t };
}

/**
 * Hook for accessing the current locale in client components.
 *
 * @returns The current locale string
 */
export function useLocale() {
  const { locale } = useI18nContext();
  return locale;
}
