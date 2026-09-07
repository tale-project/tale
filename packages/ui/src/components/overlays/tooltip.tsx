import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { cn } from '../../lib/cn';

/** First-open delay before a tip appears (accidental-hover guard). */
export const TOOLTIP_DELAY_MS = 200;
/** After one tip is open, subsequent tips in the same provider skip this wait. */
export const TOOLTIP_SKIP_DELAY_MS = 300;

/**
 * Canonical product tooltip surface — inverted chrome. Platform and @tale/ui
 * tips must share this so toolbars don't mix accent vs fg/bg dialects.
 */
export const tooltipContentClassName =
  'z-[60] max-w-xs overflow-hidden rounded-lg border bg-foreground p-2 py-1 text-xs text-wrap text-background shadow-md animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-[var(--duration-short)] motion-reduce:animate-none';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
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
