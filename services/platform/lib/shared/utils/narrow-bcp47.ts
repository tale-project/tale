/**
 * Narrow a BCP-47 locale tag to its primary language subtag.
 *
 * Examples: `de-CH` → `de`, `en-GB` → `en`, `zh-Hant-HK` → `zh`.
 * Returns `undefined` when the input has no region/script subtag, so callers
 * can chain: `i18n[locale] ?? (base ? i18n[base] : undefined) ?? i18n.en`.
 *
 * Intentionally inlined here (vs. shared via `@tale/i18n`) because the only
 * consumers are platform-side code (including Convex functions), and Convex's
 * deploy bundler doesn't resolve workspace-package subpath exports.
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
