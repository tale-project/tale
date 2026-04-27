/**
 * Narrow a BCP-47 locale tag to its primary language subtag.
 *
 * Examples: `fr-CH` → `fr`, `de-AT` → `de`, `zh-Hant-HK` → `zh`.
 * Returns `undefined` when the input has no region/script subtag, so callers
 * can chain: `i18n[locale] ?? (base ? i18n[base] : undefined) ?? i18n.en`.
 *
 * Script subtags are collapsed along with the region — acceptable for the
 * current supported locales (`en`, `de`, `fr`). If script-specific resolution
 * is ever needed (e.g. `zh-Hant` vs `zh-Hans`), swap this for `Intl.Locale`.
 */
export function narrowBcp47(
  locale: string | undefined | null,
): string | undefined {
  if (!locale || typeof locale !== 'string') return undefined;
  return locale.includes('-') ? locale.split('-')[0] : undefined;
}
