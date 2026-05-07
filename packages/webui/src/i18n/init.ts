import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import { defaultLocale } from './config';
import { detectInitialLocale } from './locales';

type Bundle = Record<string, Record<string, unknown>>;

interface InitParams {
  bundles: {
    en: Bundle;
    de: Bundle;
    fr: Bundle;
    'de-AT'?: Bundle;
    'de-CH'?: Bundle;
    'fr-CH'?: Bundle;
  };
  global?: Bundle;
}

function mergeWithGlobal(locale: Bundle, global: Bundle): Bundle {
  const out: Bundle = { ...global };
  for (const [ns, value] of Object.entries(locale)) {
    out[ns] = { ...global[ns], ...value };
  }
  return out;
}

/**
 * Initialise an i18next instance with the host app's message bundles.
 * Called once at module scope from `services/web/lib/i18n/i18n.ts` and
 * `services/docs/lib/i18n/i18n.ts` so each app keeps its own typed
 * message namespaces while sharing this glue code.
 */
export function initI18n({ bundles, global = {} }: InitParams) {
  const merge = (locale: Bundle): Bundle => mergeWithGlobal(locale, global);

  void i18n
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources: {
        en: merge(bundles.en),
        de: merge(bundles.de),
        fr: merge(bundles.fr),
        ...(bundles['de-AT']
          ? { 'de-AT': { ...bundles['de-AT'] } }
          : undefined),
        ...(bundles['de-CH']
          ? { 'de-CH': { ...bundles['de-CH'] } }
          : undefined),
        ...(bundles['fr-CH']
          ? { 'fr-CH': { ...bundles['fr-CH'] } }
          : undefined),
      },
      lng: detectInitialLocale(),
      fallbackLng: {
        'de-CH': ['de', defaultLocale],
        'de-AT': ['de', defaultLocale],
        'fr-CH': ['fr', defaultLocale],
        fr: [defaultLocale],
        default: [defaultLocale],
      },
      interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}',
      },
      react: {
        useSuspense: false,
      },
    });

  return i18n;
}

export { i18n };
