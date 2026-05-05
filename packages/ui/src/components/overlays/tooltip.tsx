import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { cn } from '../../lib/cn';

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
    className={cn(
      'z-50 overflow-hidden rounded-md bg-[color:var(--color-accent-base)] px-3 py-1.5 text-xs text-[color:var(--color-accent-fg)] shadow-md',
      'animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none',
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
