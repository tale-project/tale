import { Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { ROUTE_PATHS, type LocalizedRoutePath } from '@/lib/seo/route-paths';

export type { LocalizedRoutePath };

type BaseLinkProps = ComponentProps<typeof Link>;
type ForwardedLinkProps = Omit<BaseLinkProps, 'to' | 'params'>;

interface LocalizedLinkProps extends ForwardedLinkProps {
  to: LocalizedRoutePath;
}

/**
 * `<Link>` wrapper that resolves a canonical marketing path (`/pricing`,
 * `/`, …) into the URL for the locale of the current page.
 *
 * Pages are mounted under two parallel route trees: the unprefixed English
 * tree (`/pricing`) and the `$lang/...` tree (`/de/pricing`, `/fr/pricing`).
 * Components don't know — or care — which tree they happen to be rendered
 * under; they just say `<LocalizedLink to="/pricing">…</LocalizedLink>` and
 * this wrapper routes to the correct file-based path with the right `lang`
 * param.
 *
 * Pass-through props (`hash`, `className`, `onClick`, `aria-label`, …) are
 * forwarded as-is to the underlying TanStack `<Link>`.
 */
export function LocalizedLink({ to, ...rest }: LocalizedLinkProps) {
  const locale = useCurrentLocale();
  const target = ROUTE_PATHS[to];

  if (locale === 'en') {
    // oxlint-disable-next-line typescript/no-explicit-any -- target.en is a registered route path; the typed union loses precision through `Omit`
    return <Link to={target.en} {...(rest as any)} />;
  }
  return (
    <Link
      // oxlint-disable-next-line typescript/no-explicit-any -- target.prefixed is the registered `$lang/...` route id; same union-precision caveat
      to={target.prefixed as any}
      params={{ lang: locale }}
      // oxlint-disable-next-line typescript/no-explicit-any -- forwarded prop bag
      {...(rest as any)}
    />
  );
}
