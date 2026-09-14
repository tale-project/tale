'use client';

import { ChevronRightIcon } from 'lucide-react';
import { forwardRef, type DetailsHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

interface CollapsibleDetailsProps extends Omit<
  DetailsHTMLAttributes<HTMLDetailsElement>,
  'children'
> {
  summary: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'compact';
}

export const CollapsibleDetails = forwardRef<
  HTMLDetailsElement,
  CollapsibleDetailsProps
>(({ summary, children, variant = 'default', className, ...props }, ref) => (
  <details ref={ref} className={cn('group', className)} {...props}>
    <summary
      className={cn(
        // `items-start` keeps the chevron on the first line of a multi-line
        // summary (title + meta). `items-center` parked it mid-block.
        'flex min-w-0 cursor-pointer items-start gap-1 font-medium select-none',
        variant === 'default' ? 'text-sm' : 'text-muted-foreground text-xs',
      )}
    >
      <ChevronRightIcon
        className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-90"
        aria-hidden
      />
      {summary}
    </summary>
    {children}
  </details>
));
CollapsibleDetails.displayName = 'CollapsibleDetails';
