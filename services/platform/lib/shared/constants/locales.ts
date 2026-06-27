/**
 * Locales the platform offers as in-product translation surfaces (agent
 * metadata, provider descriptions, etc.). Distinct from `@tale/ui/i18n/locales`,
 * which lists locales for the UI message catalog — the two happen to match
 * today but the constant lives here to keep Convex-reachable callers free
 * of workspace-package subpath imports (the Convex bundler can't resolve
 * them through transitive re-exports).
 *
 * Used by `LocaleTabs` and any feature that authors localizable JSON content.
 */
export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Soft check — does NOT throw. Narrows an arbitrary string to a
 * {@link SupportedLocale}. Kept here (Node-runtime-neutral, dependency-free)
 * so both Convex modules and the React side can share the whitelist.
 */
export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
