import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

import { defaultLocale } from './config';

type Bundle = Record<string, Record<string, unknown>>;

const baseResources: Record<string, Bundle> = {
  en: { ...enMessages, ...globalMessages },
  de: { ...deMessages, ...globalMessages },
  fr: { ...frMessages, ...globalMessages },
};

const fallbackLng: Record<string, string[]> = {
  default: [defaultLocale],
};

// Auto-discover regional variants (e.g. `de-CH.json`, future `fr-CA.json`).
// Drop a `xx-YY.json` file in `messages/` and Vite picks it up here — no
// other code paths need updating. Regional variants are sparse override
// bundles, so they are not merged with `global`; i18next falls back per key
// through `[locale, base, default]`.
const REGIONAL_TAG = /^[a-z]{2}-[A-Z]{2}$/;

// Vite requires `import.meta.glob` patterns to be literal relative or
// absolute paths — aliases (`@/...`) are rejected at build time.
const regionalModules = import.meta.glob<Bundle>('../../messages/*-*.json', {
  eager: true,
  import: 'default',
});

for (const [path, bundle] of Object.entries(regionalModules)) {
  const match = /\/([^/]+)\.json$/.exec(path);
  const locale = match?.[1];
  if (!locale || !REGIONAL_TAG.test(locale)) continue;
  baseResources[locale] = bundle;
  const base = locale.split('-')[0];
  fallbackLng[locale] =
    base in baseResources ? [base, defaultLocale] : [defaultLocale];
}

void i18n
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: baseResources,
    lng: defaultLocale,
    fallbackLng,
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
