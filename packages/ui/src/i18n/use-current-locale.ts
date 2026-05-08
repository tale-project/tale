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
  // `strict: false` opts out of TanStack Router's typed param inference, so the
  // returned shape is unknown to TS. The cast is the documented escape hatch.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const params = useParams({ strict: false }) as { lang?: string };
  if (params.lang !== undefined && isUrlPrefixedLocale(params.lang)) {
    return params.lang;
  }
  return 'en';
}
