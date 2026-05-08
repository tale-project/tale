import { initI18n } from '@tale/webui/i18n/init';

import deMessages from '@/messages/de.json';
import enMessages from '@/messages/en.json';
import frMessages from '@/messages/fr.json';
import globalMessages from '@/messages/global.json';

type Bundle = Record<string, Record<string, unknown>>;

// Auto-discover regional variants (e.g. `de-CH.json`, future `fr-CA.json`).
// Drop a `xx-YY.json` file in `messages/` and Vite picks it up here.
const REGIONAL_TAG = /^[a-z]{2}-[A-Z]{2}$/;

// Vite requires `import.meta.glob` patterns to be literal relative or
// absolute paths — aliases (`@/...`) are rejected at build time.
const regionalModules = import.meta.glob<Bundle>('../../messages/*-*.json', {
  eager: true,
  import: 'default',
});

const regionalBundles: Record<string, Bundle> = {};
for (const [path, bundle] of Object.entries(regionalModules)) {
  const match = /\/([^/]+)\.json$/.exec(path);
  const locale = match?.[1];
  if (!locale || !REGIONAL_TAG.test(locale)) continue;
  regionalBundles[locale] = bundle;
}

export const i18n = initI18n({
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
    ...regionalBundles,
  },
  global: globalMessages,
});
