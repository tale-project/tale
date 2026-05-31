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
  /**
   * Suppress the automatic "(optional)" hint that every non-required labelled
   * field shows. Set on labels that aren't form inputs (group headings,
   * decorative labels) or where optionality is irrelevant.
   */
  hideOptional?: boolean;
}

export const Label = forwardRef<
  ComponentRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, required, error, hideOptional, children, ...props }, ref) => {
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
      {/* Required → red asterisk; otherwise a muted "(optional)" hint so every
          optional field is labelled consistently without editing each form.
          Opt out with `hideOptional` for non-field labels. */}
      {required ? (
        <span className="ml-1 text-red-600" aria-label={t('aria.required')}>
          *
        </span>
      ) : hideOptional ? null : (
        <span className="text-muted-foreground/70 ml-1 text-xs font-normal lowercase">
          ({t('optional')})
        </span>
      )}
    </LabelPrimitive.Root>
  );
});
Label.displayName = LabelPrimitive.Root.displayName;
