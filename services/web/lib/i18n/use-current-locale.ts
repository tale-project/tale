import { useParams } from '@tanstack/react-router';

import { isUrlPrefixedLocale, type SupportedLocale } from './locales';

/**
 * Reads the current base locale from the active route's `$lang` param.
 * Returns `'en'` for unprefixed routes (root tree) and for any param that
 * isn't a registered prefixed locale. The `$lang.tsx` layout already
 * redirects unknown params, but this hook stays defensive so it can be
 * called from components that may render briefly before that redirect
 * resolves (e.g. during navigation).
 */
export function useCurrentLocale(): SupportedLocale {
  const params = useParams({ strict: false }) as { lang?: string };
  if (params.lang !== undefined && isUrlPrefixedLocale(params.lang)) {
    return params.lang;
  }
  return 'en';
}
