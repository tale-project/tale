import { type TextareaHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'min-h-[96px] w-full rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] px-3 py-2 text-sm text-[color:var(--color-fg-base)] placeholder:text-[color:var(--color-fg-subtle)] shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:border-[color:var(--color-accent-base)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-[color:var(--color-danger)] aria-invalid:ring-[color:var(--color-danger)]/20',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
