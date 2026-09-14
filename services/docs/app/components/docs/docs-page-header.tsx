import { cn } from '@tale/ui/cn';
import { HEADER_CRUMB_LINK_CLASS } from '@tale/ui/header-breadcrumbs';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

export interface DocsCrumb {
  label: string;
  /** Slug to link to. Omitted for a nav group that has no page of its own. */
  slug?: string;
}

interface DocsBreadcrumbTrailProps {
  locale: SupportedLocale;
  crumbs: readonly DocsCrumb[];
}

/**
 * The page's breadcrumb trail in the app's header anatomy: a semantic
 * `nav > ol`, one `gap-2` everywhere, a `/` trailing each ancestor, and the
 * leaf marked `aria-current="page"`. Below `md` only the immediate parent
 * stays — the deeper trail is too wide for a phone, and the drawer covers
 * navigation.
 *
 * Unlike the platform's `HeaderBreadcrumbs`, the leaf here is a plain span:
 * a docs page's single `h1` is the article title below, and two `h1`s would
 * break both the heading outline and the prerender contract.
 */
function DocsBreadcrumbTrail({ locale, crumbs }: DocsBreadcrumbTrailProps) {
  const { t } = useT('docs');
  // The docs root is always the first crumb, so a locale landing page (which
  // contributes no crumbs of its own) still renders a trail — with "Home" as
  // its own leaf rather than a separator pointing at nothing.
  const items: DocsCrumb[] = [{ label: t('home'), slug: 'index' }, ...crumbs];
  const ancestors = items.slice(0, -1);
  const leaf = items[items.length - 1];

  return (
    <nav
      aria-label={t('breadcrumbs')}
      className="text-muted-foreground flex min-w-0 items-center text-sm"
    >
      <ol className="flex min-w-0 items-center gap-2">
        {ancestors.map((crumb, i) => (
          <li
            key={`${crumb.label}-${i}`}
            className={cn(
              'shrink-0 items-center gap-2',
              // Keep only the immediate parent on a phone.
              i === ancestors.length - 1 ? 'flex' : 'hidden md:flex',
            )}
          >
            {crumb.slug ? (
              <Link
                to={docPath(locale, crumb.slug)}
                activeOptions={{ exact: true }}
                className={HEADER_CRUMB_LINK_CLASS}
              >
                {crumb.label}
              </Link>
            ) : (
              <span>{crumb.label}</span>
            )}
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-center">
          <span
            aria-current="page"
            className="text-foreground min-w-0 truncate font-medium"
          >
            {leaf.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}

interface DocsPageHeaderProps {
  locale: SupportedLocale;
  crumbs: readonly DocsCrumb[];
  /** Right-hand page actions (copy page, open in …). */
  actions?: ReactNode;
}

/**
 * The article's header strip — the app's single `h-13` header row: trail on
 * the left, page actions on the right, one `border-border` line under it.
 * Sticky from `md` up, where it is the only pinned chrome in the column; on a
 * phone the `MobileAppHeader` owns the top of the viewport, so the row
 * scrolls with the article and stacks the actions under the trail.
 */
export function DocsPageHeader({
  locale,
  crumbs,
  actions,
}: DocsPageHeaderProps) {
  return (
    <div className="border-border bg-background/95 z-20 border-b backdrop-blur-md md:sticky md:top-0">
      <div className="flex flex-col gap-2 px-4 py-2.5 md:h-13 md:flex-row md:items-center md:gap-4 md:py-0 lg:px-6">
        <DocsBreadcrumbTrail locale={locale} crumbs={crumbs} />
        {actions ? (
          <div className="flex shrink-0 items-center gap-1 md:ml-auto">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
