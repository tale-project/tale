'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { PageHeader } from '@/app/components/layout/page-header';
import { cn } from '@/lib/utils/cn';

interface SettingsPageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  /**
   * Page title (h1). Omit to render a header-less page — the whole title
   * block is skipped when there's no title and no header/sticky action. Used
   * by the Organization page, whose tab strip already names the section.
   */
  title?: ReactNode;
  /** One-sentence description shown directly below the title. */
  description?: ReactNode;
  /** Optional right-aligned action(s) in the page header (e.g. export). */
  headerAction?: ReactNode;
  /**
   * Right-aligned editor actions (Save/Discard) shown in the page header.
   * Distinct from `headerAction` only in that setting this flag makes the
   * header block sticky so the cluster stays reachable while the user
   * scrolls a long form. Used by every non-tabbed settings page on the
   * unified save UX.
   */
  stickyActions?: ReactNode;
  /**
   * Constrains the page content to a centered reading column matching
   * `ContentArea variant="narrow"` (`max-w-[544px] mx-auto`) used by other
   * form-heavy pages (project overview, agent settings). Use for personal
   * and org-level settings pages whose forms read better in a single
   * column. Pages dominated by a data table or side-by-side preview should
   * leave this `false` (default) and let their own layout dictate width.
   */
  narrow?: boolean;
  /**
   * Makes the page participate in its parent's flex height so a single
   * child can claim the remaining viewport — required when the child uses
   * `DataTable stickyLayout`, an internally-scrolling tab strip, or any
   * other component that needs a bounded height to drive its own scroll
   * container. The parent route must itself be a `flex flex-col` ancestor
   * with `min-h-0` for this to engage. Default `false` keeps the page in
   * normal document flow so long forms scroll the outer container.
   */
  fitToContainer?: boolean;
  /** Section content — `<SettingsSection>` children separated by 32px gap. */
  children?: ReactNode;
}

/**
 * Every settings page top-level wrapper. Provides the consistent title block
 * + outer stack between sections (gap-8 = 32px) so the visual rhythm is the
 * same on every page in the settings area.
 */
export function SettingsPage({
  title,
  description,
  headerAction,
  stickyActions,
  narrow,
  fitToContainer,
  children,
  className,
  ...props
}: SettingsPageProps) {
  const headerSlot = stickyActions ?? headerAction;
  const showHeader = title != null || description != null || headerSlot != null;
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-8',
        narrow && 'mx-auto max-w-[544px] self-center',
        fitToContainer && 'min-h-0 flex-1',
        className,
      )}
      {...props}
    >
      {showHeader && (
        // Shared canonical page header. `stickyActions` keeps the Save/Discard
        // cluster reachable on long forms by pinning the whole header strip;
        // without it the header is static (the default everywhere else).
        <PageHeader
          title={title}
          description={description}
          action={headerSlot}
          className={cn(
            stickyActions &&
              'bg-background/80 sticky top-0 z-20 -mx-4 px-4 py-3 backdrop-blur-md sm:items-center',
          )}
        />
      )}
      {children && (
        <div
          className={cn(
            'flex flex-col gap-8',
            // Bottom breathing room. ContentArea's `py-6` lives on a `flex-1`
            // child of the scroll container, so its padding-bottom is clipped
            // at the scroll boundary; a `pb-6` on this content-sized wrapper
            // is part of the scrolled flow and renders reliably at scroll end.
            // Skip it for `fitToContainer` pages, whose child owns its own
            // scroll and must fill the box edge-to-edge.
            fitToContainer ? 'min-h-0 flex-1' : 'pb-6',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
