/**
 * i18n Abstraction Layer
 *
 * This module provides a thin abstraction over next-intl,
 * allowing for easy migration to another i18n library if needed.
 *
 * Usage:
 *
 * Client Components:
 * ```tsx
 * import { useT } from '@/lib/i18n';
 *
 * function MyComponent() {
 *   const { t } = useT('common');
 *   return <button>{t('actions.save')}</button>;
 * }
 * ```
 *
 * Server Components:
 * ```tsx
 * import { getT } from '@/lib/i18n/server';
 *
 * export default async function Page() {
 *   const { t } = await getT('common');
 *   return <h1>{t('title')}</h1>;
 * }
 * ```
 */

// Client exports (default)
export { useT, useTranslations, useLocale } from './client';

// Configuration
export {
  locales,
  defaultLocale,
  dayjsLocaleMap,
  isSupportedLocale,
  type Locale,
} from './config';

// Types
export type { Namespace, Messages } from './types';
