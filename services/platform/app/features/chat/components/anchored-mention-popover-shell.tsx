'use client';

import { type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils/cn';

import { useMentionPopoverPosition } from '../hooks/use-mention-popover-position';

interface AnchoredMentionPopoverShellProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Portals a mention listbox to `document.body` with fixed coordinates derived
 * from the composer anchor. Escapes overflow clipping in dialogs/panels and
 * auto-flips above/below based on viewport space.
 */
export function AnchoredMentionPopoverShell({
  anchorRef,
  open,
  className,
  children,
}: AnchoredMentionPopoverShellProps) {
  const coords = useMentionPopoverPosition(anchorRef, open);
  if (!open || !coords || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'border-border bg-popover text-popover-foreground fixed z-[100] w-max max-w-xs min-w-48 overflow-hidden rounded-xl border shadow-lg',
        coords.placement === 'above' && '-translate-y-full',
        className,
      )}
      style={{
        left: coords.left,
        top: coords.top,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
