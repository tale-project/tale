import {
  Outlet,
  createFileRoute,
  notFound,
  redirect,
} from '@tanstack/react-router';

import { isUrlPrefixedLocale } from '@/lib/i18n/locales';

/**
 * Layout route for `/$lang/...`. Validates that `$lang` is one of the
 * URL-prefixed locales we serve (`de`, `fr`). `/en` canonicalizes to the
 * unprefixed English tree; any other unknown segment is a real 404 (the
 * old silent redirect to `/` taught crawlers that garbage URLs are the
 * homepage). The component is a transparent `<Outlet />` — actual page
 * rendering happens in the child routes, which reuse the same page
 * components as the unprefixed tree.
 *
 * The active locale is exposed to descendants via the route's `lang`
 * param; `useCurrentLocale()` reads it.
 */
export const Route = createFileRoute('/$lang')({
  beforeLoad: ({ params }) => {
    if (!isUrlPrefixedLocale(params.lang)) {
      if (params.lang === 'en') throw redirect({ to: '/' });
      throw notFound();
    }
  },
  component: LangLayout,
});

function LangLayout() {
  return <Outlet />;
}
