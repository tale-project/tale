import { type TextareaHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Skeleton-aware Textarea. Always wraps the real field in a `<SkeletonBox>`:
 * idle, the box is `display: contents`; inside a `<Skeletonize loading>` it
 * masks the field with an overlay at its exact size (incl. `rows`).
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => (
    <SkeletonBox fullWidth>
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'min-h-[96px] w-full rounded-lg border px-3 py-2 text-base md:text-sm',
          'border-[color:var(--color-border-input)] bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)] placeholder:text-[color:var(--color-fg-subtle)] shadow-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:border-[color:var(--color-accent-base)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-[color:var(--color-danger)] aria-invalid:ring-[color:var(--color-danger)]/20',
          className,
        )}
        {...props}
      />
    </SkeletonBox>
  ),
);
Textarea.displayName = 'Textarea';
