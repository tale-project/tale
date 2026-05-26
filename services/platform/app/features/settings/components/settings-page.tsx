'use client';

import { Description } from '@tale/ui/description';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface SettingsPageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'title'
> {
  /** Page title (h1). */
  title: ReactNode;
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
      <header
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
          stickyActions &&
            'bg-background/80 sticky top-0 z-20 -mx-4 px-4 py-3 backdrop-blur-md sm:items-center',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-foreground text-lg leading-tight font-semibold">
            {title}
          </h1>
          {description && (
            <Description className="text-muted-foreground text-sm">
              {description}
            </Description>
          )}
        </div>
        {headerSlot && (
          <div className="flex shrink-0 items-center justify-end">
            {headerSlot}
          </div>
        )}
      </header>
      {children && (
        <div
          className={cn(
            'flex flex-col gap-8',
            fitToContainer && 'min-h-0 flex-1',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
