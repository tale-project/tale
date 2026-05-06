import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import deAtMessages from '@/messages/de-AT.json';
import deChMessages from '@/messages/de-CH.json';
import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frChMessages from '@/messages/fr-CH.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

import { defaultLocale } from './config';
import { detectInitialLocale } from './locales';

type Bundle = Record<string, Record<string, unknown>>;

// Merge per-locale namespaces on top of shared globals one namespace deep,
// so locale-specific keys (e.g. `languageSwitcher.ariaLabel`) coexist with
// shared keys (e.g. `languageSwitcher.locales`) instead of clobbering them.
function mergeWithGlobal(locale: Bundle, global: Bundle): Bundle {
  const out: Bundle = { ...global };
  for (const [ns, value] of Object.entries(locale)) {
    out[ns] = { ...global[ns], ...value };
  }
  return out;
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: {
      de: mergeWithGlobal(deMessages, globalMessages),
      'de-AT': {
        ...deAtMessages,
      },
      'de-CH': {
        ...deChMessages,
      },
      en: mergeWithGlobal(enMessages, globalMessages),
      fr: mergeWithGlobal(frMessages, globalMessages),
      'fr-CH': {
        ...frChMessages,
      },
    },
    // Resolve the initial language from the URL pathname (`/de/...` →
    // `de`, `/fr/...` → `fr`, otherwise the default English) so the
    // very first render in both SSR and CSR uses the correct bundle and
    // there is no flash of the wrong language. The `__root.tsx` layout
    // re-syncs `i18n.language` to the regional variant on subsequent
    // route changes.
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

export { i18n };
