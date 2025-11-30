'use client';

import { forwardRef, ComponentRef, ComponentPropsWithoutRef } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils/cn';

const labelVariants = cva(
  'leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-xs md:text-sm font-medium text-muted-foreground',
);

interface LabelProps
  extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
  VariantProps<typeof labelVariants> {
  required?: boolean;
  error?: boolean;
}

const Label = forwardRef<ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, error, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(labelVariants(), error && 'text-destructive', className)}
      {...props}
    >
      {children}
      {required && (
        <span className="text-red-600 ml-1" aria-label="required">
          *
        </span>
      )}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
