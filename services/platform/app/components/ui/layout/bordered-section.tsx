'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

const borderedSectionVariants = cva(
  'flex flex-col gap-3 rounded-lg border border-border',
  {
    variants: {
      padding: {
        3: 'p-3',
        4: 'p-4',
      },
    },
    defaultVariants: {
      padding: 4,
    },
  },
);

interface BorderedSectionProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof borderedSectionVariants> {}

export const BorderedSection = forwardRef<HTMLDivElement, BorderedSectionProps>(
  ({ padding, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(borderedSectionVariants({ padding }), className)}
      {...props}
    />
  ),
);
BorderedSection.displayName = 'BorderedSection';
