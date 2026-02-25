'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

interface SelectableRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export const SelectableRow = forwardRef<HTMLButtonElement, SelectableRowProps>(
  ({ selected, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50',
        selected && 'ring-primary ring-2',
        className,
      )}
      {...props}
    />
  ),
);
SelectableRow.displayName = 'SelectableRow';
