import { type TextareaHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import { useSkeleton } from '../feedback/skeleton-context';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// Plain control — the real textarea field. No skeleton logic of its own.
const TextareaBase = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'min-h-[96px] w-full rounded-lg border px-3 py-2 text-base md:text-sm',
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
TextareaBase.displayName = 'TextareaBase';

/**
 * Skeleton-aware Textarea. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size (incl. `rows`), pulse overlay on top — so the skeleton can
 * never drift.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (props, ref) => {
    const loading = useSkeleton();
    if (loading) {
      return (
        <SkeletonBox>
          <TextareaBase {...props} ref={ref} />
        </SkeletonBox>
      );
    }
    return <TextareaBase {...props} ref={ref} />;
  },
);
Textarea.displayName = 'Textarea';
