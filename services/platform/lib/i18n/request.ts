/**
 * i18n Request Configuration
 *
 * Server-side configuration for next-intl.
 * This file is referenced by the next-intl plugin in next.config.ts.
 */

import { getRequestConfig } from 'next-intl/server';
import { defaultLocale } from './config';

export default getRequestConfig(async () => {
  // For now, use the default locale.
  // In the future, this can be extended to:
  // - Read locale from cookies
  // - Detect from Accept-Language header
  // - Get from user preferences in database
  const locale = defaultLocale;

  // Load locale-specific and global messages in parallel
  const [localeMessages, globalMessages] = await Promise.all([
    import(`@/messages/${locale}.json`).then((m) => m.default),
    import('@/messages/global.json').then((m) => m.default),
  ]);

  return {
    locale,
    // Merge global messages (same across all locales) with locale-specific messages
    messages: { ...globalMessages, ...localeMessages },
  };
});
