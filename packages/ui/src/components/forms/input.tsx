import { type InputHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import { useSkeleton } from '../feedback/skeleton-context';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

// Plain control — the real input field. No skeleton logic of its own.
const InputBase = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-10 w-full rounded-lg border px-3 py-2 text-base md:text-sm',
        'border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] text-[color:var(--color-fg-base)] placeholder:text-[color:var(--color-fg-subtle)] shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:border-[color:var(--color-accent-base)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-[color:var(--color-danger)] aria-invalid:ring-[color:var(--color-danger)]/20',
        className,
      )}
      {...props}
    />
  ),
);
InputBase.displayName = 'InputBase';

/**
 * Skeleton-aware Input. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size, pulse overlay on top — so the skeleton can never drift.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <InputBase {...props} ref={ref} />
      </SkeletonBox>
    );
  }
  return <InputBase {...props} ref={ref} />;
});
Input.displayName = 'Input';
