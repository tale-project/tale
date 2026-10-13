'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long the one-shot guard waits for the focus restore before it lets go.
 * Radix keeps a closing popover mounted for its ~150ms exit animation and
 * only then returns focus to the trigger, so the guard must outlive that.
 */
const RELEASE_AFTER_MS = 500;

export interface TriggerTooltipGuard {
  /** Whether the trigger's tooltip is open — never while the popover is. */
  open: boolean;
  /** The tooltip root's `onOpenChange`. */
  onOpenChange: (next: boolean) => void;
  /** Call when the popover closes, before focus comes back to the trigger. */
  suppressNextOpen: () => void;
}

/**
 * The open state of a tooltip on a popover's trigger.
 *
 * Closing a popover returns focus to its trigger, which Radix Tooltip reads as
 * a focus-to-open and flashes the tooltip over the value just picked. The
 * guard is armed when the popover closes and swallows exactly that one open;
 * a timer releases it if no focus restore ever arrives (the popover was
 * dismissed by a click far from the trigger), so a later genuine hover still
 * opens the tip. The tooltip is also held shut while the popover is open.
 */
export function useTriggerTooltipGuard(
  popoverOpen: boolean,
): TriggerTooltipGuard {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const onOpenChange = useCallback((next: boolean) => {
    if (next && suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    setTooltipOpen(next);
  }, []);

  const suppressNextOpen = useCallback(() => {
    suppressRef.current = true;
    setTooltipOpen(false);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      suppressRef.current = false;
      timerRef.current = null;
    }, RELEASE_AFTER_MS);
  }, []);

  return { open: tooltipOpen && !popoverOpen, onOpenChange, suppressNextOpen };
}
