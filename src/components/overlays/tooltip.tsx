'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/** First-open delay before a tip appears (accidental-hover guard). */
export const TOOLTIP_DELAY_MS = 200;
/** After one tip is open, subsequent tips in the same provider skip this wait. */
export const TOOLTIP_SKIP_DELAY_MS = 300;

/**
 * Canonical product tooltip surface — inverted chrome. Every tip in every
 * Tale surface shares this so toolbars don't mix accent vs fg/bg dialects.
 */
export const tooltipContentClassName =
  'z-[60] max-w-xs overflow-hidden rounded-lg border bg-foreground p-2 py-1 text-xs text-wrap text-background shadow-md animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-[var(--duration-short)] motion-reduce:animate-none';

export const TooltipProvider = TooltipPrimitive.Provider;
/**
 * The Radix root. Compose it with `TooltipTrigger` + `TooltipContent` when a
 * tip needs more than the convenience `Tooltip` offers (a custom trigger
 * element, controlled portals, arrow, …).
 */
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(tooltipContentClassName, className)}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  /**
   * Minimum gap (px) kept between the tooltip and the viewport edge when Radix
   * flips/shifts it to avoid a collision. Without this the tooltip can sit
   * flush against an edge and visually overlap adjacent controls in cramped
   * toolbars (e.g. the composer's attach button).
   */
  collisionPadding?: number;
  /**
   * Per-tip override for open delay. Prefer the app-shell TooltipProvider
   * defaults so skip-delay works across a toolbar; only set this for tips that
   * must differ (e.g. denser chrome).
   */
  delayDuration?: number;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The one-line tooltip: wraps a single trigger element and renders `content`
 * in the canonical surface. Relies on the `AppShell` `TooltipProvider` for
 * delay and skip-delay — do not wrap each instance in its own Provider. An
 * empty `content` renders the children bare so callers can pass it
 * unconditionally.
 */
export function Tooltip({
  content,
  children,
  side,
  sideOffset = 4,
  collisionPadding = 8,
  delayDuration,
  contentClassName,
  open,
  onOpenChange,
}: TooltipProps) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cn(tooltipContentClassName, contentClassName)}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
