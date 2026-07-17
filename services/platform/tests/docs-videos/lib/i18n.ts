/**
 * Locale-bound label resolution for scene choreography. The e2e helper
 * (`tests/e2e/helpers/i18n.ts`) is pinned to `en` by design — 100+ specs
 * record English-only. Video scenes record under en, de AND fr, so they
 * resolve labels from the locale's own catalog; a missing key throws at
 * record time (fail fast — a silent English fallback would produce a locator
 * that misses the localized UI).
 */

import { createI18n } from '@tale/e2e/i18n';

import type { Locale } from './episode';

const resolvers = new Map<Locale, (key: string) => string>();

export function localeT(locale: Locale): (key: string) => string {
  let t = resolvers.get(locale);
  if (!t) {
    t = createI18n(
      new URL(`../../../messages/${locale}.json`, import.meta.url),
    ).t;
    resolvers.set(locale, t);
  }
  return t;
}

/** Context locale for Playwright (`Accept-Language`, Intl formatting). */
export function contextLocale(locale: Locale): string {
  return { en: 'en-US', de: 'de-DE', fr: 'fr-FR' }[locale];
}
