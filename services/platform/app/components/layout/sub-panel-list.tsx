'use client';

import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { cn } from '@/lib/utils/cn';

/**
 * The one list vocabulary every sub-panel speaks — the settings rail and the
 * chat panel compose their navigation from these pieces, so a row, a section
 * label, or a disclosure reads identically on both.
 */

/** Row anatomy: h-8, rounded-md, 13px text, muted hover fill, inset focus
 * ring — one rhythm from the settings rail to the chat lists. */
export const SUB_PANEL_ROW_CLASS =
  'flex h-8 items-center rounded-md px-2 text-[13px] transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none';

export interface SubPanelRowTreatment {
  className: string;
  style?: CSSProperties;
}

/**
 * Active/idle row treatment. Branded orgs tint the active row with the org
 * accent; unbranded ones keep the muted-gray fallback.
 */
export function useSubPanelRowTreatment(active: boolean): SubPanelRowTreatment {
  const { accentColor } = useBrandingContext();
  if (active && accentColor) {
    return {
      className: 'font-medium',
      style: { backgroundColor: `${accentColor}26`, color: accentColor },
    };
  }
  return {
    className: active
      ? 'bg-muted text-foreground font-medium'
      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
  };
}

/**
 * A leaf navigation row: a router link in the shared row anatomy. Takes a
 * resolved path — a row that needs route params (like a chat thread) composes
 * {@link SUB_PANEL_ROW_CLASS} + {@link useSubPanelRowTreatment} around its own
 * typed `Link` instead.
 */
export function SubPanelRowLink({
  to,
  active,
  className,
  children,
}: {
  to: string;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const treatment = useSubPanelRowTreatment(active);
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(SUB_PANEL_ROW_CLASS, treatment.className, className)}
      {...(treatment.style !== undefined ? { style: treatment.style } : {})}
    >
      {children}
    </Link>
  );
}

/**
 * Uppercase section label with an optional right-aligned action slot. Fixed
 * height so a header with an action button doesn't sit taller than one
 * without. `sticky` pins it over the scrolling rows (opaque background so
 * scrolled rows disappear under it; z-20 clears the rows' own z-10 hover
 * overlays).
 */
export function SubPanelSectionHeader({
  label,
  action,
  sticky = false,
  className,
}: {
  label: string;
  action?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-7 items-center justify-between gap-1 px-2',
        sticky && 'bg-background sticky top-0 z-20',
        className,
      )}
    >
      <Text
        as="div"
        variant="caption"
        className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
      >
        {label}
      </Text>
      {action}
    </div>
  );
}

/**
 * Animated disclosure body — the grid-row trick animates to content height
 * without JS measurement, and the closed state is inert so nothing inside is
 * reachable while hidden.
 */
export function SubPanelDisclosureBody({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
