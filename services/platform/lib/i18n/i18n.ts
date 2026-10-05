import { detectPreferredLocale } from '@tale/ui/i18n/detect-locale';
import { initServiceI18n } from '@tale/ui/i18n/init-service';
import { loadLocale } from '@tale/ui/i18n/load-locale';
import { uiMessages } from '@tale/ui/i18n/messages';

import enMessages from '@/messages/en.yml';
import globalMessages from '@/messages/global.yml';

type Bundle = Record<string, Record<string, unknown>>;

export const i18n = initServiceI18n({
  bundles: { en: enMessages },
  // German and French load when a session first needs them: each is about
  // 110 KB gzip, and a session reads one language. English, which every key
  // falls back to, ships with the app.
  lazyBundles: {
    de: () => import('@/messages/de.yml').then((module) => module.default),
    fr: () => import('@/messages/fr.yml').then((module) => module.default),
  },
  // Vite requires the glob pattern to be a literal at the call site.
  regional: import.meta.glob<Bundle>('../../messages/*-*.yml', {
    eager: true,
    import: 'default',
  }),
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
