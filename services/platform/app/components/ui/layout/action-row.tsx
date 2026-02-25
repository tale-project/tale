'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

const actionRowVariants = cva('flex items-center', {
  variants: {
    justify: {
      start: 'justify-start',
      end: 'justify-end',
      between: 'justify-between',
    },
    gap: {
      1: 'gap-1',
      2: 'gap-2',
      3: 'gap-3',
    },
  },
  defaultVariants: {
    justify: 'start',
    gap: 2,
  },
});

interface ActionRowProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof actionRowVariants> {}

export const ActionRow = forwardRef<HTMLDivElement, ActionRowProps>(
  ({ justify, gap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(actionRowVariants({ justify, gap }), className)}
      {...props}
    />
  ),
);
ActionRow.displayName = 'ActionRow';
