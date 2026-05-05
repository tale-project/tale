import * as LabelPrimitive from '@radix-ui/react-label';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { cn } from '../../lib/cn';

export const Label = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-sm font-medium text-[color:var(--color-fg-base)] leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Label.displayName = 'Label';
