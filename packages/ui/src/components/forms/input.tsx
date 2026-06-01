import { type InputHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Skeleton-aware Input. Always wraps the real field in a `<SkeletonBox>`: idle,
 * the box is `display: contents` and adds nothing; inside a
 * `<Skeletonize loading>` it masks the field with an overlay at its exact size.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <SkeletonBox fullWidth>
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-10 w-full rounded-lg border px-3 py-2 text-base md:text-sm',
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
Input.displayName = 'Input';
