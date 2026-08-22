'use client';

import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

interface PanelFooterProps extends HTMLAttributes<HTMLDivElement> {}

export const PanelFooter = forwardRef<HTMLDivElement, PanelFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('bg-background sticky bottom-0 z-50', className)}
      {...props}
    />
  ),
);
PanelFooter.displayName = 'PanelFooter';
