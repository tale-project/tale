/** Platform's UI default locale. Inlined (vs. re-exported from
 *  `@tale/ui/i18n/config`) because Convex's deploy bundler doesn't resolve
 *  workspace-package subpath exports through transitive re-exports. The
 *  value is intentionally kept in sync with `@tale/ui/i18n/config`'s
 *  `defaultLocale`. */
export const defaultLocale = 'en' as const;
