import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';

import { isUrlPrefixedLocale } from '@/lib/i18n/locales';

/**
 * Layout route for `/$lang/...`. Validates that `$lang` is one of the
 * URL-prefixed locales we serve (`de`, `fr`) and redirects everything
 * else (including `/en`, which should be canonicalized to the unprefixed
 * tree) to the English root. The component is a transparent `<Outlet />`
 * — actual page rendering happens in the child routes, which reuse the
 * same page components as the unprefixed tree.
 *
 * The active locale is exposed to descendants via the route's `lang`
 * param; `useCurrentLocale()` reads it.
 */
export const Route = createFileRoute('/$lang')({
  beforeLoad: ({ params }) => {
    if (!isUrlPrefixedLocale(params.lang)) {
      throw redirect({ to: '/' });
    }
  },
  component: LangLayout,
});

function LangLayout() {
  return <Outlet />;
}
