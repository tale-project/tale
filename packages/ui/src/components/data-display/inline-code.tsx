'use client';

import type { HTMLAttributes } from 'react';
import { forwardRef } from 'react';

import { cn } from '../../lib/cn';

interface InlineCodeProps extends HTMLAttributes<HTMLElement> {}

export const InlineCode = forwardRef<HTMLElement, InlineCodeProps>(
  ({ className, ...props }, ref) => (
    <code
      ref={ref}
      className={cn(
        'bg-muted rounded px-1 py-0.5 font-mono text-xs',
        className,
      )}
      {...props}
    />
  ),
);
InlineCode.displayName = 'InlineCode';
