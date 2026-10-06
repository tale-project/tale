import { detectPreferredLocale } from '@tale/ui/i18n/detect-locale';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { loadLocale } from '@tale/ui/i18n/load-locale';
import { uiMessages } from '@tale/ui/i18n/messages';
import {
  catalogsByLocale,
  loadLocaleTopics,
} from '@tale/ui/i18n/topic-catalogs';

import globalMessages from '@/messages/global.yml';

// Every catalog is a directory of topic files, one namespace each
// (`messages/<locale>/<topic>.yml`), the same topics in every locale.
// English, which every key falls back to, ships with the app, and so do the
// sparse regional overrides (`de-CH`). Vite requires the glob patterns to be
// literals at the call site.
const shipped = catalogsByLocale(
  import.meta.glob<Record<string, unknown>>(
    ['../../messages/en/*.yml', '../../messages/*-*/*.yml'],
    { eager: true, import: 'default' },
  ),
);
// German and French load when a session first needs them: each is about
// 110 KB gzip, and a session reads one language.
const fetched = import.meta.glob<Record<string, unknown>>(
  ['../../messages/de/*.yml', '../../messages/fr/*.yml'],
  { import: 'default' },
);

export const i18n = initServiceI18n({
  bundles: { ...shipped, en: shipped.en ?? {} },
  lazyBundles: {
    de: () => loadLocaleTopics(fetched, 'de'),
    fr: () => loadLocaleTopics(fetched, 'fr'),
  },
  regional: {},
  global: globalMessages,
  packages: [uiMessages],
});

const sessionLocale = detectPreferredLocale();

/**
 * The session's language, its messages in the store and switched to, before
 * the first frame: `LocaleProvider` starts from the same detection, and the
 * root route waits for this, so the first frame and every page title already
 * speak it. Started with the app's own modules, so a German or French
 * catalog is fetched alongside the session check. Never rejects: when the
 * messages do not load, the page stays in English, and `LocaleSync` fetches
 * them again when it mounts.
 */
export const sessionLocaleReady: Promise<void> = loadLocale(i18n, sessionLocale)
  .then(async () => {
    if (i18n.language !== sessionLocale) {
      await i18n.changeLanguage(sessionLocale);
    }
  })
  .catch((error: unknown) => {
    console.warn(
      `[i18n] the ${sessionLocale} messages did not load; the page stays in ${i18n.language}`,
      error,
    );
  });
