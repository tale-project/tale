/**
 * Locales the platform offers as in-product translation surfaces (agent
 * metadata, provider descriptions, etc.). Distinct from `@tale/i18n/locales`,
 * which lists locales for the UI message catalog — the two happen to match
 * today but the constant lives here to keep Convex-reachable callers free
 * of workspace-package subpath imports (the Convex bundler can't resolve
 * them through transitive re-exports).
 *
 * Used by `LocaleTabs` and any feature that authors localizable JSON content.
 */
export const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;

type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
