'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, ComponentRef, ComponentPropsWithoutRef } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface LabelProps extends ComponentPropsWithoutRef<
  typeof LabelPrimitive.Root
> {
  required?: boolean;
  error?: boolean;
}

export const Label = forwardRef<
  ComponentRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, required, error, children, ...props }, ref) => {
  const { t } = useT('common');
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-xs md:text-sm font-medium text-muted-foreground',
        error && 'text-destructive',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-1 text-red-600" aria-label={t('aria.required')}>
          *
        </span>
      )}
    </LabelPrimitive.Root>
  );
});
Label.displayName = LabelPrimitive.Root.displayName;
