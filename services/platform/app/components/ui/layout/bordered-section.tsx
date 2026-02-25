'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

const borderedSectionVariants = cva(
  'flex flex-col rounded-lg border border-border',
  {
    variants: {
      gap: {
        2: 'gap-2',
        3: 'gap-3',
        4: 'gap-4',
      },
      padding: {
        3: 'p-3',
        4: 'p-4',
      },
    },
    defaultVariants: {
      gap: 3,
      padding: 4,
    },
  },
);

interface BorderedSectionProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof borderedSectionVariants> {}

export const BorderedSection = forwardRef<HTMLDivElement, BorderedSectionProps>(
  ({ gap, padding, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(borderedSectionVariants({ gap, padding }), className)}
      {...props}
    />
  ),
);
BorderedSection.displayName = 'BorderedSection';
