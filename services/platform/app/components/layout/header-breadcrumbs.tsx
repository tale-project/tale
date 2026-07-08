import { Heading } from '@tale/ui/heading';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * The one interactive-crumb style: page-title typography dimmed via colour
 * only (#2543), with the shared focus ring. Callers put this on the `Link`
 * or `button` they pass as an ancestor crumb's content, so the component can
 * stay router-agnostic while every trail styles identically.
 */
export const HEADER_CRUMB_LINK_CLASS =
  'text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

export interface HeaderBreadcrumbCrumb {
  key: string;
  /** A fully-rendered `Link`/`button` (carrying {@link HEADER_CRUMB_LINK_CLASS})
   *  or plain text for a non-navigable ancestor. */
  content: ReactNode;
}

/**
 * The page-chrome breadcrumb every detail page renders inside
 * `AdaptiveHeaderRoot`: a semantic `nav > ol` trail whose LEAF is the page's
 * single `h1` (`aria-current="page"`). Ancestors hide below `md` (the mobile
 * header shows only the leaf) and every gap is the same `gap-2`, so the trail
 * reads identically on agents, automations, workflows, and projects. The
 * separator trails each ancestor `li`, so the leaf needs none of its own.
 */
export function HeaderBreadcrumbs({
  ariaLabel,
  crumbs,
  leaf,
  className,
}: {
  ariaLabel: string;
  crumbs: readonly HeaderBreadcrumbCrumb[];
  /** The current page's title content — rendered as the `h1` leaf; wrap
   *  loading names in `Skeletonize` at the call site. */
  leaf: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('flex min-w-0 items-center', className)}
    >
      <ol className="flex min-w-0 items-center gap-2 text-base font-semibold">
        {crumbs.map((crumb) => (
          <li
            key={crumb.key}
            className="hidden shrink-0 items-center gap-2 md:flex"
          >
            {crumb.content}
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-center">
          <Heading level={1} size="base" truncate aria-current="page">
            {leaf}
          </Heading>
        </li>
      </ol>
    </nav>
  );
}
