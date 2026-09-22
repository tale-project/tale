'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

interface SelectableRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export const SelectableRow = forwardRef<HTMLButtonElement, SelectableRowProps>(
  ({ selected, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(
        'bg-card hover:bg-accent/50 flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        selected && 'ring-primary ring-2',
        className,
      )}
      {...props}
    />
  ),
);
SelectableRow.displayName = 'SelectableRow';
