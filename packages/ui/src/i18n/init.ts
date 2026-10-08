import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import { defaultLocale } from './config';
import { detectInitialLocale } from './detect-locale';
import { memoizeLanguageHierarchy } from './language-hierarchy';
import { registerLocaleLoader } from './load-locale';

type Bundle = Record<string, Record<string, unknown>>;

interface InitParams {
  /**
   * Base-locale bundles are required; any additional entry is treated as a
   * regional variant (key shape `xx-YY`). Adding a new regional locale is a
   * matter of dropping a JSON file in and listing it here — no other code
   * paths need updating.
   */
  bundles: {
    en: Bundle;
    de?: Bundle;
    fr?: Bundle;
  } & Record<string, Bundle | undefined>;
  global?: Bundle;
  /**
   * Base locales fetched when first needed instead of up front: each
   * answers its bundle, which lands merged with `global` like the others.
   * `loadLocale` fetches one; `LocaleSync` does before switching to it.
   */
  lazy?: Partial<Record<'de' | 'fr', () => Promise<Bundle>>>;
}

function mergeWithGlobal(locale: Bundle, global: Bundle): Bundle {
  const out: Bundle = { ...global };
  for (const [ns, value] of Object.entries(locale)) {
    out[ns] = { ...global[ns], ...value };
  }
  return out;
}

const BASE_LOCALES = new Set(['en', 'de', 'fr']);

/**
 * Initialise an i18next instance with the host app's message bundles.
 * Called once at module scope from `services/web/lib/i18n/i18n.ts` and
 * `services/docs/lib/i18n/i18n.ts` so each app keeps its own typed
 * message namespaces while sharing this glue code.
 */
export function initI18n({ bundles, global = {}, lazy = {} }: InitParams) {
  const merge = (locale: Bundle): Bundle => mergeWithGlobal(locale, global);

  const resources: Record<string, Bundle> = { en: merge(bundles.en) };
  for (const base of ['de', 'fr'] as const) {
    const bundle = bundles[base];
    if (bundle !== undefined) resources[base] = merge(bundle);
  }
  const fallbackLng: Record<string, string[]> = {
    default: [defaultLocale],
  };

  // Regional variants are sparse override bundles, not merged with `global`.
  // i18next falls back per key through `[locale, base, default]`, so global
  // namespace keys remain reachable via the base locale — and a regional
  // bundle can still override a global key when it needs to.
  for (const [locale, bundle] of Object.entries(bundles)) {
    if (BASE_LOCALES.has(locale) || !bundle) continue;
    resources[locale] = bundle;
    const base = locale.split('-')[0];
    fallbackLng[locale] = BASE_LOCALES.has(base)
      ? [base, defaultLocale]
      : [defaultLocale];
  }

  void i18n
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources,
      lng: detectInitialLocale(),
      fallbackLng,
      interpolation: {
        escapeValue: false,
        prefix: '{',
        suffix: '}',
      },
      react: {
        useSuspense: false,
      },
      // The ICU plugin memoizes each message under the language asked for, a
      // fallback's included: a language whose messages land after its first
      // read (`lazy`) would keep answering the fallback. Its memo starts over
      // whenever a bundle lands.
      i18nFormat: { bindI18nStore: 'added' },
    });
  // `init` builds the instance's services synchronously, so the language
  // utilities exist by now.
  memoizeLanguageHierarchy(i18n);
  for (const [locale, fetch] of Object.entries(lazy)) {
    if (fetch !== undefined) {
      registerLocaleLoader(i18n, locale, () => fetch().then(merge));
    }
  }

  return i18n;
}

export { i18n };
