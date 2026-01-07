'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

interface DescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  /** Display muted/secondary styling (default: true) */
  muted?: boolean;
}

export const Description = forwardRef<HTMLParagraphElement, DescriptionProps>(
  ({ className, muted = true, ...props }, ref) => (
    <p
      ref={ref}
      className={cn(
        'text-xs md:text-sm leading-relaxed',
        muted && 'text-muted-foreground',
        className
      )}
      {...props}
    />
  )
);
Description.displayName = 'Description';

