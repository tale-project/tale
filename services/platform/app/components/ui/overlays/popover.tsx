'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  contentClassName?: string;
  modal?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
}

const CONTENT_CLASSES =
  'z-50 min-w-[14.5rem] max-w-64 w-auto p-4 rounded-lg ring-1 ring-border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2';

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'center',
  side,
  sideOffset = 4,
  contentClassName,
  modal,
  onOpenAutoFocus,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          onOpenAutoFocus={onOpenAutoFocus}
          className={cn(CONTENT_CLASSES, contentClassName)}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
