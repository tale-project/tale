import { detectPreferredLocale } from '@tale/ui/i18n/detect-locale';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { loadLocale } from '@tale/ui/i18n/load-locale';
import { uiMessages } from '@tale/ui/i18n/messages';
import { topicLoaders } from '@tale/ui/i18n/topic-catalogs';

import globalMessages from '@/messages/global.yml';

// Every catalog is a directory of topic files, one namespace each
// (`messages/<locale>/<topic>.yml`), the same topics in every locale, and
// every locale loads per topic. English, which every key falls back to,
// comes with the code that reads it (the `messageTopics` plugin in
// `vite.config.ts`); German, French and the Swiss overrides are fetched per
// topic, in the language the session shows, as its pages need them. Vite
// requires the glob patterns to be literals at the call site.
const topics = topicLoaders(
  import.meta.glob<Record<string, unknown>>(
    ['../../messages/*/*.yml', '!../../messages/en/*.yml'],
    { import: 'default' },
  ),
);

export const i18n = initServiceI18n({
  bundles: { en: {} },
  topics: {
    lazy: topics,
    // Without the build's chunks, nothing waits for the topics a module
    // brings: the dev server and the test runs fetch a language whole.
    eager: !import.meta.env.PROD,
  },
  regional: {},
  global: globalMessages,
  packages: [uiMessages],
});

const sessionLocale = detectPreferredLocale();

// The topics of the session's language start loading as the app's own
// modules register theirs, alongside the session check.
loadLocale(i18n, sessionLocale).catch((error: unknown) => {
  console.warn(`[i18n] the ${sessionLocale} messages did not load`, error);
});

let sessionLocaleSwitch: Promise<void> | undefined;

/**
 * The session's language, the topics of the app's first page in the store
 * and switched to, before the first frame: `LocaleProvider` starts from the
 * same detection, and the root route waits for this, so the first frame and
 * every page title already speak it. Called by the root route's loader once
 * every module of the cold load has registered its topics; it switches the
 * language once, whatever the later navigations. Never rejects: when the
 * messages do not load, the page stays in English, and `LocaleSync` fetches
 * them again when it mounts.
 */
export function sessionLocaleReady(): Promise<void> {
  sessionLocaleSwitch ??= loadLocale(i18n, sessionLocale)
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
  return sessionLocaleSwitch;
}
