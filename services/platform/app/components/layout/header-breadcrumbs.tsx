import { Heading } from '@tale/ui/heading';
import { IconButton } from '@tale/ui/icon-button';
import { ArrowLeft } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
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
 * single `h1` (`aria-current="page"`). The full ancestor trail shows from `md`
 * up; below `md` it collapses to a single icon-only back button to the
 * IMMEDIATE parent so a detail page always has a way back on a phone — the
 * full trail is too wide there, and the parent's label eats scarce header
 * width (unless {@link showImmediateParentOnMobile} opts in to
 * `[parent] / [leaf]`). Every gap is the same `gap-2`, so the trail reads
 * identically on agents, automations, workflows, and projects. The separator
 * trails each ancestor `li`, so the leaf needs none of its own.
 */
export function HeaderBreadcrumbs({
  ariaLabel,
  crumbs,
  leaf,
  className,
  showImmediateParentOnMobile = false,
}: {
  ariaLabel: string;
  crumbs: readonly HeaderBreadcrumbCrumb[];
  /** The current page's title content — rendered as the `h1` leaf; wrap
   *  loading names in `Skeletonize` at the call site. */
  leaf: ReactNode;
  className?: string;
  /**
   * When true, keep the last ancestor visible below `md` so the title reads
   * `[parent] / [leaf]` (agent file-based detail pages). Default keeps all
   * ancestor crumbs desktop-only.
   */
  showImmediateParentOnMobile?: boolean;
}) {
  const { t } = useT('common');
  // Below `md` the full trail is hidden (too wide for a phone header), so a
  // detail page would otherwise have NO way back. Collapse to an icon-only
  // back button to the immediate parent (the last ancestor): `IconButton
  // asChild` re-uses that crumb's own `Link` — swapping its label for a back
  // arrow — so the destination and the router stay the caller's, and the
  // control is a compact icon rather than a width-hungry label. The desktop
  // trail below renders the same ancestor node; one copy is `display:none`
  // per breakpoint, so exactly one parent link stays in the a11y tree —
  // unless `showImmediateParentOnMobile`, which keeps the last trail crumb
  // visible alongside the back control (same destination, different names).
  const parentContent = crumbs.at(-1)?.content;
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      {isValidElement(parentContent) && (
        <IconButton
          asChild
          slotChild={parentContent}
          icon={ArrowLeft}
          iconSize={5}
          size="sm"
          aria-label={t('aria.back')}
          className="-ml-1.5 shrink-0 md:hidden"
        />
      )}
      <ol className="flex min-w-0 items-center gap-2 text-base font-semibold">
        {crumbs.map((crumb, i) => {
          const isImmediateParent = i === crumbs.length - 1;
          const showOnMobile = showImmediateParentOnMobile && isImmediateParent;
          return (
            <li
              key={crumb.key}
              className={cn(
                'shrink-0 items-center gap-2',
                showOnMobile ? 'flex' : 'hidden md:flex',
              )}
            >
              {crumb.content}
              <span className="text-muted-foreground" aria-hidden="true">
                /
              </span>
            </li>
          );
        })}
        <li className="flex min-w-0 items-center">
          <Heading level={1} size="base" truncate aria-current="page">
            {leaf}
          </Heading>
        </li>
      </ol>
    </nav>
  );
}
