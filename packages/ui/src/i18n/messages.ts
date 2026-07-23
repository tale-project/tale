import type { PackageMessages } from './init-service';
import deMessages from './messages/de.yml';
import enMessages from './messages/en.yml';
import frMessages from './messages/fr.yml';
import globalMessages from './messages/global.yml';

/**
 * Shared translation bundles owned by `@tale/i18n` — keys consumed by
 * components shipped in `@tale/ui` (language switcher, theme switcher,
 * etc.). The host service merges these into its i18n instance via
 * `initServiceI18n({ packages: [uiMessages] })`, so every component
 * shipped from `@tale/ui` can call `useT(...)` without the consuming
 * app duplicating the keys in its own `messages/*.json`.
 *
 * Locale-neutral keys (entries that read the same in every language)
 * live in `global.json` and fold into every base locale — same
 * convention services follow for their own `messages/global.json`.
 */
export const uiMessages: PackageMessages = {
  bundles: {
    en: enMessages,
    de: deMessages,
    fr: frMessages,
  },
  global: globalMessages,
};
