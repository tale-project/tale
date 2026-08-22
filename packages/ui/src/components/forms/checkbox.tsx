import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  type SyntheticEvent,
  forwardRef,
} from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../overlays/disabled-reason';

export interface CheckboxProps extends ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> {
  /**
   * Explains *why* the checkbox is disabled, surfaced in a tooltip on hover AND
   * focus and to screen readers (#1949). Only takes effect while the checkbox
   * is `disabled`; ignored otherwise, so callers can pass it unconditionally.
   *
   * A natively-`disabled` control emits no pointer events and leaves the tab
   * order, so no tooltip could reach it. When a disabled checkbox carries a
   * `disabledReason` we therefore keep it focusable (still rendered visually
   * disabled and inert to clicks/Space), swap `disabled` for `aria-disabled`,
   * and let the shared Tooltip wire up `aria-describedby`.
   */
  disabledReason?: ReactNode;
}

/**
 * Skeleton-aware Checkbox. Always wraps the real control in a `<SkeletonBox>`:
 * idle, the box is `display: contents`; inside a `<Skeletonize loading>` it
 * masks the control with an overlay at its exact size.
 */
export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    { className, disabled, disabledReason, onClick, onKeyDown, ...props },
    ref,
  ) => {
    // Soft-disable keeps the control focusable + hoverable (so the reason
    // tooltip reaches pointer and keyboard users) while blocking activation.
    const softDisabled = Boolean(disabled) && hasDisabledReason(disabledReason);
    // Calling preventDefault here also stops Radix's composed toggle handler,
    // so the checked state can't change while soft-disabled.
    const blockActivation = (event: SyntheticEvent & { key?: string }) => {
      // Space activates a checkbox; let other keys (Tab, arrows) through.
      if ('key' in event && event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
    };
    return (
      <SkeletonBox>
        <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
          <CheckboxPrimitive.Root
            ref={ref}
            disabled={softDisabled ? undefined : disabled}
            // Only the soft-disabled branch needs `aria-disabled`; a natively
            // `disabled` control already conveys the state, so emitting it there
            // too would be redundant with the native attribute.
            aria-disabled={softDisabled || undefined}
            onClick={softDisabled ? blockActivation : onClick}
            onKeyDown={softDisabled ? blockActivation : onKeyDown}
            className={cn(
              'peer h-4 w-4 shrink-0 rounded border border-[color:var(--color-border-strong)] bg-[color:var(--color-bg-base)] shadow-sm transition-colors',
              'focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:ring-offset-2 focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              'data-[state=checked]:border-[color:var(--color-accent-base)] data-[state=checked]:bg-[color:var(--color-accent-base)] data-[state=checked]:text-[color:var(--color-accent-fg)]',
              'data-[state=indeterminate]:bg-[color:var(--color-accent-base)] data-[state=indeterminate]:text-[color:var(--color-accent-fg)]',
              className,
            )}
            {...props}
          >
            <CheckboxPrimitive.Indicator className="flex items-center justify-center [&[data-state=checked]_.check]:block [&[data-state=indeterminate]_.minus]:block">
              <Check className="check hidden h-3 w-3" aria-hidden />
              <Minus className="minus hidden h-3 w-3" aria-hidden />
            </CheckboxPrimitive.Indicator>
          </CheckboxPrimitive.Root>
        </DisabledReasonTooltip>
      </SkeletonBox>
    );
  },
);
Checkbox.displayName = 'Checkbox';
