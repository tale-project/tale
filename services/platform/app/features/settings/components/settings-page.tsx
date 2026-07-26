'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { FIELD_LAYOUT_ROW } from '@/app/components/ui/forms/field-shell';
import { cn } from '@/lib/utils/cn';

/**
 * The section-divider rule for configuration surfaces: every
 * `SettingsSection` after the first is separated from its predecessor by one
 * hairline. `SettingsPage` applies it for the whole settings area; other
 * configuration surfaces built from `SettingsSection` — the project overview
 * page, for one — apply it to their own section container instead of
 * hand-rolling `border-t pt-8` on individual sections, so all of them share
 * one rhythm and none can forget a line on a single sibling.
 *
 * Dividers key on `SettingsSection`'s `data-settings-section` marker, never on
 * "every child". Two shapes have to work, and one must NOT:
 *
 *   • sections as siblings — either directly under the page, or all inside one
 *     wrapper (a `<Skeletonize>`, a `<form>`), which is how several governance
 *     pages are built;
 *   • sections each inside their own wrapper, siblings at the page level —
 *     matched by asking whether a child CONTAINS a section;
 *   • a wrapper holding a section header plus its table: those children are
 *     not sections, so they get no line between them — the stray divider that
 *     appeared under Teams / Skills / Sandboxes / Branding / Trash and the
 *     environment page.
 *
 * Dialogs and other children that render nothing where they sit never match
 * either rule, so a page can no longer end on a divider with empty space.
 * Written as whole literals: Tailwind generates CSS from the class strings it
 * finds in the source, so an interpolated selector would emit nothing.
 */
export const SECTION_DIVIDER_CLASS =
  '[&_[data-settings-section]~[data-settings-section]]:border-border [&_[data-settings-section]~[data-settings-section]]:border-t [&_[data-settings-section]~[data-settings-section]]:pt-8 [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:border-border [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:border-t [&>:is([data-settings-section],:has([data-settings-section]))~:is([data-settings-section],:has([data-settings-section]))]:pt-8';

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
 *
 * It also declares the settings field layout: every labelled control beneath
 * it reads label-left / control-right from `sm` up (see `FieldShell`), the
 * same rhythm `SettingsRow` and `SettingsToggleRow` already had. Dialogs
 * portal out of this subtree, so their fields keep stacking.
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
      {...FIELD_LAYOUT_ROW}
      className={cn(
        'flex w-full flex-col gap-8',
        // Every section after the first gets the same divider, owned by the
        // shared rule so no page can forget it on one sibling and render an
        // inconsistent rhythm.
        SECTION_DIVIDER_CLASS,
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
