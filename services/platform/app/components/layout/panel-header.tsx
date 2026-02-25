'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

const panelHeaderVariants = cva(
  'sticky top-0 z-50 flex shrink-0 items-center border-b border-border bg-background/50',
  {
    variants: {
      variant: {
        default: 'h-16 px-4 py-3',
        compact: 'p-3',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface PanelHeaderProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof panelHeaderVariants> {}

export const PanelHeader = forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ variant, className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(panelHeaderVariants({ variant }), className)}
      style={{
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
        ...style,
      }}
      {...props}
    />
  ),
);
PanelHeader.displayName = 'PanelHeader';
