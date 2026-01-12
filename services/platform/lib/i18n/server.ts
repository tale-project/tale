/**
 * i18n Server Abstraction
 *
 * Provides a wrapper around next-intl's getTranslations function.
 * This abstraction layer allows easy migration to another i18n library
 * by only changing this file.
 *
 * @example
 * ```tsx
 * import { getT } from '@/lib/i18n/client';
 *
 * export default async function Page() {
 *   const { t } = await getT('common');
 *   return <h1>{t('title')}</h1>;
 * }
 * ```
 */

import {
  getTranslations,
  getLocale as getNextIntlLocale,
} from 'next-intl/server';
import type { Namespace } from './types';

/**
 * Get translations for server components.
 *
 * @param namespace - The translation namespace to use
 * @returns Object containing the translation function
 */
export async function getT<N extends Namespace>(namespace: N) {
  const t = await getTranslations(namespace);
  return { t };
}

/**
 * Get the current locale in server components.
 *
 * @returns The current locale string
 */
export async function getLocale() {
  return getNextIntlLocale();
}

export { getT as getTranslations };
