import {
  LanguageSwitcher as LanguageSwitcherBase,
  stripLocalePrefix,
} from '@tale/webui/layout/language-switcher';

import type { SupportedLocale } from '@/lib/i18n/locales';

/**
 * Marketing-site language switcher. The visual + state machinery lives in
 * `@tale/webui/layout/language-switcher`; this wrapper supplies the
 * URL-resolution rule for our two parallel route trees.
 *
 * - English keeps the canonical path (`/pricing`).
 * - `de` and `fr` get prefixed (`/de/pricing`, `/fr` for the home).
 *
 * Search params and hash are dropped — keeping them was previously
 * possible because we built TanStack-router options directly. The shared
 * switcher takes a plain URL string, which is fine for marketing pages
 * (no deep-linked filters today). If we ever need them again, extend the
 * `resolveLocaleUrl` callback to receive `{ search, hash }`.
 */
function resolveWebLocaleUrl(
  target: SupportedLocale,
  pathname: string,
): string {
  const canonical = stripLocalePrefix(pathname);
  if (target === 'en') return canonical;
  return canonical === '/' ? `/${target}` : `/${target}${canonical}`;
}

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  return (
    <LanguageSwitcherBase
      resolveLocaleUrl={resolveWebLocaleUrl}
      className={className}
    />
  );
}
