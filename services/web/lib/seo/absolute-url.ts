import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { absoluteSitePath } from '@tale/ui/seo/urls';

import { localizedPath, type SupportedLocale } from '@/lib/i18n/locales';
import type { LocalizedRoutePath } from '@/lib/seo/route-paths';

/**
 * Absolute marketing URL for the active locale. JSON-LD breadcrumbs and
 * WebSite nodes must match the page's canonical (localized) URL — not the
 * English-only path.
 */
export function absoluteLocalizedUrl(
  locale: SupportedLocale,
  path: LocalizedRoutePath,
): string {
  return absoluteSitePath(TALE_SITE_URL, localizedPath(locale, path));
}
