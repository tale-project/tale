import { AsyncLocalStorage } from 'node:async_hooks';

import { createI18n } from '@tale/e2e/i18n';

import { CAPTURE_LOCALES, type CaptureLocale } from './capture-options';

const UI_MESSAGES = new URL(
  '../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);
const resolvers = new Map(
  CAPTURE_LOCALES.map((locale) => [
    locale,
    createI18n(new URL(`../../messages/${locale}/`, import.meta.url), {
      packages: [
        new URL('global.yml', UI_MESSAGES),
        new URL(`${locale}.yml`, UI_MESSAGES),
      ],
    }),
  ]),
);
const captureLocale = new AsyncLocalStorage<CaptureLocale>();

/** Each scene's asynchronous preparation and restore use its own native labels.
 * The regular E2E/seed resolver stays English and is never mutated.
 */
export function withCaptureLocale<T>(
  locale: CaptureLocale,
  action: () => T,
): T {
  return captureLocale.run(locale, action);
}

export function t(key: string): string {
  const locale = captureLocale.getStore() ?? 'en';
  const resolver = resolvers.get(locale);
  if (!resolver) throw new Error(`Unsupported capture locale: ${locale}`);
  return resolver.t(key);
}
