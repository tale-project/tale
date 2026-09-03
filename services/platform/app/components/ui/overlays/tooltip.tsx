'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Shared surface for every platform tooltip — one place for width/wrap rules. */
export const tooltipContentClassName =
  'bg-foreground text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[60] max-w-xs overflow-hidden rounded-lg border p-2 py-1 text-xs text-wrap shadow-md';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  /**
   * Minimum gap (px) kept between the tooltip and the viewport edge when Radix
   * flips/shifts it to avoid a collision. Without this the tooltip can sit
   * flush against an edge and visually overlap adjacent controls in cramped
   * toolbars (e.g. the composer's attach button) — #1461.
   */
  collisionPadding?: number;
  delayDuration?: number;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Tooltip({
  content,
  children,
  side,
  sideOffset = 4,
  collisionPadding = 8,
  delayDuration = 300,
  contentClassName,
  open,
  onOpenChange,
}: TooltipProps) {
  if (!content) return <>{children}</>;

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root open={open} onOpenChange={onOpenChange}>
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
    </TooltipPrimitive.Provider>
  );
}
