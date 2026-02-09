'use client';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';

const spinnerVariants = cva(
  'animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground',
  {
    variants: {
      size: {
        sm: 'size-4',
        md: 'size-6',
        lg: 'size-8',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

interface SpinnerProps extends VariantProps<typeof spinnerVariants> {
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
}

export function Spinner({ size, className, label = 'Loading' }: SpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(spinnerVariants({ size }), className)}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}
