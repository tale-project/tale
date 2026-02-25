'use client';

import { ChevronRightIcon } from 'lucide-react';
import { forwardRef, type DetailsHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

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
        'flex cursor-pointer items-center gap-1 font-medium select-none',
        variant === 'default' ? 'text-sm' : 'text-muted-foreground text-xs',
      )}
    >
      <ChevronRightIcon
        className="size-4 shrink-0 transition-transform group-open:rotate-90"
        aria-hidden
      />
      {summary}
    </summary>
    {children}
  </details>
));
CollapsibleDetails.displayName = 'CollapsibleDetails';
