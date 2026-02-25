import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils/cn';

export const FullPageCenter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex h-screen items-center justify-center', className)}
    {...props}
  />
));
FullPageCenter.displayName = 'FullPageCenter';
