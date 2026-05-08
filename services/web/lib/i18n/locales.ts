/**
 * Marketing site locale model. Re-exports the shared locale primitives
 * from `@tale/webui/i18n/locales` so `services/web` and `services/docs`
 * agree on which locales URL-prefix vs which fall through to a base.
 *
 * Both apps render in three base locales: English (the default, served
 * at the root path with no prefix) and German + French (served under
 * `/de/...` and `/fr/...` prefixes). Regional variants (e.g. `de-CH`) are
 * resolved at the i18n layer when content benefits from region-specific
 * overrides — they never appear in URLs.
 */

export {
  detectInitialLocale,
  isUrlPrefixedLocale,
  resolveRegionalLocale,
} from '@tale/webui/i18n/locales';
export type { SupportedLocale } from '@tale/webui/i18n/locales';
