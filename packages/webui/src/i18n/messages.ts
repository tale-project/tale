import type { PackageMessages } from '@tale/ui/i18n/init-service';

import deMessages from '../messages/de.json';
import enMessages from '../messages/en.json';
import frMessages from '../messages/fr.json';
import globalMessages from '../messages/global.json';

/**
 * Translation bundles owned by `@tale/webui`. The host service merges
 * these into its i18n instance via
 * `initServiceI18n({ packages: [webuiMessages] })`, so the shared
 * site-header / footer / switcher components work without each
 * consuming app re-declaring the keys in its own `messages/*.json`.
 *
 * Locale-neutral keys (e.g. `languageSwitcher.locales.*`, where each
 * language is shown in its own native form) live in `global.json` and
 * fold into every base locale — same convention services follow.
 *
 * Each top-level key inside a locale bundle is a namespace scoped to
 * the component family it serves (`languageSwitcher`, `themeSwitcher`,
 * …) — pick a name distinct enough that a service is unlikely to want
 * it for its own keys.
 */
export const webuiMessages: PackageMessages = {
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
  },
  global: globalMessages,
};
