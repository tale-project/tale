import { cn } from '@tale/ui/cn';
import { HEADER_CRUMB_LINK_CLASS } from '@tale/ui/header-breadcrumbs';
import { useT } from '@tale/ui/i18n/client';
import type { ReactNode } from 'react';

import { DocsAncestorLink } from './docs-ancestor-link';
import type { DocsCrumb } from './docs-nav';

/**
 * The page's breadcrumb trail in the app's header anatomy: a semantic
 * `nav > ol`, one `gap-2` everywhere, a `/` trailing each ancestor, and the
 * leaf marked `aria-current="page"`. Below `lg` only the immediate parent
 * stays — beside the rail and the page actions a 768px window leaves the
 * trail ~200px, too narrow for a deeper trail, and the rail and the drawer
 * cover navigation. What remains shares the squeeze in proportion to its
 * length — the short root crumb keeps its width — truncating with an
 * ellipsis, so the trail never runs past the strip.
 *
 * Unlike the platform's `HeaderBreadcrumbs`, the leaf here is a plain span:
 * a docs page's single `h1` is the article title below, and two `h1`s would
 * break both the heading outline and the prerender contract.
 */
function DocsBreadcrumbTrail({ crumbs }: { crumbs: readonly DocsCrumb[] }) {
  const { t } = useT('docs');
  const ancestors = crumbs.slice(0, -1);
  const leaf = crumbs.at(-1);

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
              'items-center gap-2',
              // The root crumb is short by nature and keeps its width; the
              // others truncate in proportion to their length, like the leaf.
              i === 0 ? 'shrink-0' : 'min-w-0',
              // Keep only the immediate parent below `lg`.
              i === ancestors.length - 1 ? 'flex' : 'hidden lg:flex',
            )}
          >
            {crumb.href ? (
              <DocsAncestorLink
                to={crumb.href}
                activeOptions={{ exact: true }}
                className={cn(HEADER_CRUMB_LINK_CLASS, 'min-w-0 truncate')}
              >
                {crumb.label}
              </DocsAncestorLink>
            ) : (
              <span className="min-w-0 truncate">{crumb.label}</span>
            )}
            <span className="text-muted-foreground shrink-0" aria-hidden="true">
              /
            </span>
          </li>
        ))}
        {leaf ? (
          <li className="flex min-w-0 items-center">
            <span
              aria-current="page"
              className="text-foreground min-w-0 truncate font-medium"
            >
              {leaf.label}
            </span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}

export interface DocsHeaderProps {
  /**
   * The trail from the documentation's front door to this page. The last
   * crumb is the current page; a site's landing page passes one crumb.
   */
  crumbs: readonly DocsCrumb[];
  /** Right-hand page actions (copy page, open in …). */
  actions?: ReactNode;
}

/**
 * The article's header strip — the app's single `h-13` header row: trail on
 * the left, page actions on the right, one `border-border` line under it.
 *
 * From `md` up the strip IS the `h-13` box, border included (Tailwind's
 * `border-box`), exactly like the rail's logo row beside it — so the two
 * bottom borders stay one line whether or not the strip carries actions.
 * Never wrap a fixed-height row in a bordered parent: the border then sits
 * outside the height and the strip ends a pixel below the rail. Sticky from
 * `md` up, where it is the only pinned chrome in the column; on a phone the
 * `MobileAppHeader` owns the top of the viewport, so the strip scrolls with
 * the article and stacks the actions under the trail.
 */
export function DocsHeader({ crumbs, actions }: DocsHeaderProps) {
  return (
    <div className="border-border/70 bg-background/90 z-20 flex shrink-0 flex-col gap-2 border-b px-5 py-3 backdrop-blur-md md:sticky md:top-0 md:h-13 md:flex-row md:items-center md:gap-4 md:py-0 lg:px-8">
      <DocsBreadcrumbTrail crumbs={crumbs} />
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1 md:ml-auto print:hidden">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
