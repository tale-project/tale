'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { gapScale } from './layout';

const actionRowVariants = cva('flex items-center', {
  variants: {
    justify: {
      start: 'justify-start',
      end: 'justify-end',
      between: 'justify-between',
    },
    // Subset of the shared `gapScale` so action clusters never drift from the
    // one spacing scale. Surface stays 1|2|3 (default 2) for back-compat.
    gap: {
      1: gapScale[1],
      2: gapScale[2],
      3: gapScale[3],
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
