import { useParams } from '@tanstack/react-router';

import { isUrlPrefixedLocale, type SupportedLocale } from './locales';

/**
 * Reads the current base locale from the active route's `$lang` param.
 * Returns `'en'` for unprefixed routes and for any param that isn't a
 * registered prefixed locale. Stays defensive so it can be called from
 * components rendering briefly during navigation, before the `$lang.tsx`
 * layout's redirect resolves.
 */
export function useCurrentLocale(): SupportedLocale {
  // `strict: false` returns the union of every route's params; `select`
  // narrows the access in a single typed callback so we don't need a cast
  // at the read site.
  const lang = useParams({
    strict: false,
    select: (params: { lang?: string }) => params.lang,
  });
  if (lang !== undefined && isUrlPrefixedLocale(lang)) return lang;
  return 'en';
}
