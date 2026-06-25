import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactElement, type ReactNode } from 'react';

import { TooltipContent } from './tooltip';

export interface DisabledReasonTooltipProps {
  /**
   * The reason the control is disabled, shown in the tooltip and wired to the
   * trigger via `aria-describedby` (Radix does this while the tip is open).
   */
  reason: ReactNode;
  /**
   * Whether the affordance is live — true only when the control is both
   * disabled AND carries a `reason`. When false the child renders bare, so
   * callers can wrap unconditionally.
   */
  active: boolean;
  /** Side the tooltip opens on (default `top`). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * The single focusable control to wrap. It must forward its ref and spread
   * props (every shared form primitive does) so Radix can attach the trigger.
   */
  children: ReactElement;
}

/**
 * Whether a `disabledReason` is meaningful enough to soft-disable a control.
 *
 * Soft-disabling trades a native `disabled` (inert, out of the tab order) for a
 * focusable `aria-disabled` control whose only justification is the reason it
 * surfaces. An absent reason — `null`/`undefined`, a boolean, or an
 * empty/whitespace-only string — would leave the control inert *and* focusable
 * while explaining nothing, which is strictly worse than a native disable. In
 * that case callers should fall back to the native `disabled` behaviour, so the
 * shared primitives gate `softDisabled` on this helper rather than a bare null
 * check.
 */
export function hasDisabledReason(reason: ReactNode): boolean {
  if (reason == null || typeof reason === 'boolean') return false;
  if (typeof reason === 'string') return reason.trim() !== '';
  return true;
}

/**
 * Wraps a soft-disabled control in the shared Tooltip so the reason it's
 * disabled reaches pointer and keyboard users alike (#1949).
 *
 * A natively-`disabled` control emits no pointer events and leaves the tab
 * order, so neither a hover nor a focus tooltip could ever reach it. The shared
 * form/button primitives therefore "soft-disable" instead — they keep the
 * control focusable and swap the native `disabled` attribute for
 * `aria-disabled` while making activation inert — and hand the control here to
 * surface the reason. The shared Radix tooltip wires up `aria-describedby` so
 * screen-reader users hear the reason on focus, exactly as sighted users see it
 * on hover.
 */
export function DisabledReasonTooltip({
  reason,
  active,
  side,
  children,
}: DisabledReasonTooltipProps): ReactElement {
  if (!active || !hasDisabledReason(reason)) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipContent side={side}>{reason}</TooltipContent>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
