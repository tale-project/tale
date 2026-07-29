import { type TextareaHTMLAttributes, type ReactNode, forwardRef } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../overlays/disabled-reason';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Explains *why* the field is disabled, surfaced in a tooltip on hover AND
   * focus and to screen readers (#1949). Only takes effect while the field is
   * `disabled`; ignored otherwise, so callers can pass it unconditionally.
   *
   * A natively-`disabled` field emits no pointer events and leaves the tab
   * order, so no tooltip could reach it. When a disabled field carries a
   * `disabledReason` we therefore keep it focusable and `readOnly` (still
   * rendered visually disabled and inert to edits), swap `disabled` for
   * `aria-disabled`, and let the shared Tooltip wire up `aria-describedby`.
   */
  disabledReason?: ReactNode;
}

/**
 * Skeleton-aware Textarea. Always wraps the real field in a `<SkeletonBox>`:
 * idle, the box is `display: contents`; inside a `<Skeletonize loading>` it
 * masks the field with an overlay at its exact size (incl. `rows`).
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, rows = 4, disabled, disabledReason, readOnly, ...props },
    ref,
  ) => {
    // Soft-disable keeps the field focusable + hoverable (so the reason tooltip
    // reaches pointer and keyboard users) while `readOnly` blocks edits.
    const softDisabled = Boolean(disabled) && hasDisabledReason(disabledReason);
    return (
      <SkeletonBox fullWidth>
        <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
          <textarea
            ref={ref}
            rows={rows}
            disabled={softDisabled ? undefined : disabled}
            // Only the soft-disabled branch needs `aria-disabled`; a natively
            // `disabled` field already conveys the state, so emitting it there
            // too would be redundant with the native attribute.
            aria-disabled={softDisabled || undefined}
            readOnly={softDisabled ? true : readOnly}
            className={cn(
              'min-h-[120px] w-full rounded-lg border px-3 py-2 text-base md:text-sm',
              'border-[color:var(--color-border-input)] bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)] placeholder:text-[color:var(--color-fg-subtle)] shadow-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:border-[color:var(--color-accent-base)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              'aria-invalid:border-[color:var(--color-danger)] aria-invalid:ring-[color:var(--color-danger)]/20',
              className,
            )}
            {...props}
          />
        </DisabledReasonTooltip>
      </SkeletonBox>
    );
  },
);
Textarea.displayName = 'Textarea';
