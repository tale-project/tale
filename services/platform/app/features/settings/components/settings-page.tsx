'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface SettingsPageProps extends HTMLAttributes<HTMLDivElement> {
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
  /**
   * Opts out of the standard `max-w-3xl` content cap (#2567) for a page
   * whose content genuinely needs the full settings pane width — e.g. a
   * `DataTable` with an explicit per-column size floor wider than ~736px
   * (audit logs, legal hold, data-subject requests, usage). Document the
   * reason at the call site; most settings pages should NOT set this.
   */
  fullWidth?: boolean;
  /** Section content — `<SettingsSection>` children separated by 32px gap. */
  children?: ReactNode;
}

/**
 * Every settings page top-level wrapper. Settings pages carry no page
 * title/description — the settings rail already names the page — so this is a
 * pure layout shell: a consistent stack between sections (gap-8 = 32px) so
 * the visual rhythm is the same on every page in the settings area.
 *
 * Content is capped at `max-w-3xl` and left-aligned by default — the same
 * width as the agent editor's Tools/Starters tabs — so every settings
 * surface shares one measure (#2567). Pass `fullWidth` for the documented
 * exceptions that host a wider `DataTable`.
 */
export function SettingsPage({
  fitToContainer,
  fullWidth,
  children,
  className,
  ...props
}: SettingsPageProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-8',
        // Every section after the first gets the same divider, owned HERE so
        // no page can forget it on one sibling and render an inconsistent
        // rhythm. Applies to direct children (sections or their Skeletonize
        // wrappers); pages that nest sections inside one child (e.g. a
        // single <Form>) draw their own internal dividers.
        '[&>*+*]:border-border [&>*+*]:border-t [&>*+*]:pt-8',
        !fullWidth && 'mx-auto max-w-3xl',
        // Bottom breathing room. ContentArea's `py-6` lives on a `flex-1`
        // child of the scroll container, so its padding-bottom is clipped
        // at the scroll boundary; a `pb-6` on this content-sized wrapper
        // is part of the scrolled flow and renders reliably at scroll end.
        // Skip it for `fitToContainer` pages, whose child owns its own
        // scroll and must fill the box edge-to-edge.
        fitToContainer ? 'min-h-0 flex-1' : 'pb-6',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
