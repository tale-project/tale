'use client';

import { forwardRef, HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

interface InlineCodeProps extends HTMLAttributes<HTMLElement> {}

export const InlineCode = forwardRef<HTMLElement, InlineCodeProps>(
  ({ className, ...props }, ref) => (
    <code
      ref={ref}
      className={cn(
        'bg-muted rounded px-1 py-0.5 text-xs font-mono',
        className,
      )}
      {...props}
    />
  ),
);
InlineCode.displayName = 'InlineCode';
