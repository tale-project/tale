import deMessages from '../messages/de.json';
import enMessages from '../messages/en.json';
import frMessages from '../messages/fr.json';
import globalMessages from '../messages/global.json';
import type { PackageMessages } from './init-service';

/**
 * Translation bundles owned by `@tale/ui`. The host service merges these
 * into its i18n instance via `initServiceI18n({ packages: [uiMessages] })`,
 * so every component shipped here can call `useT(...)` without the
 * consuming app duplicating the keys in its own `messages/*.json`.
 *
 * Locale-neutral keys (entries that read the same in every language)
 * live in `global.json` and fold into every base locale — same
 * convention services follow for their own `messages/global.json`.
 *
 * Each top-level key inside a locale bundle is a namespace scoped to
 * the component family it serves (`piiPlayground`, `piiTypes`, …) —
 * pick a name distinct enough that a service is unlikely to want it
 * for its own keys.
 */
export const uiMessages: PackageMessages = {
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
  },
  global: globalMessages,
};
