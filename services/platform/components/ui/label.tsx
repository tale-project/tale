'use client';

import { forwardRef, ComponentRef, ComponentPropsWithoutRef } from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';

const labelVariants = cva(
  'leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-xs md:text-sm font-medium text-muted-foreground',
);

interface LabelProps
  extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
  VariantProps<typeof labelVariants> {
  required?: boolean;
  error?: boolean;
}

export const Label = forwardRef<ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, required, error, children, ...props }, ref) => {
    const { t } = useT('common');
    return (
      <LabelPrimitive.Root
        ref={ref}
        className={cn(labelVariants(), error && 'text-destructive', className)}
        {...props}
      >
        {children}
        {required && (
          <span className="text-red-600 ml-1" aria-label={t('aria.required')}>
            *
          </span>
        )}
      </LabelPrimitive.Root>
    );
  },
);
Label.displayName = LabelPrimitive.Root.displayName;

