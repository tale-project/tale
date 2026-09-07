'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { tooltipContentClassName } from '@tale/ui/tooltip';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export { tooltipContentClassName };

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
 * Platform tooltip. Relies on the AppShell TooltipProvider for delay and
 * skip-delay — do not wrap each instance in its own Provider. Surface classes
 * come from `@tale/ui` so Button tips and feature tips share one skin.
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
