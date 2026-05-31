'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, ComponentRef, ComponentPropsWithoutRef } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface LabelProps extends ComponentPropsWithoutRef<
  typeof LabelPrimitive.Root
> {
  /**
   * Controls the suffix shown after the label text. Optionality is opt-in:
   * the consuming field passes this explicitly so non-field labels (group
   * headings, decorative labels) stay clean by default.
   * - `true` → red required asterisk (`*`)
   * - `false` → muted `(optional)` hint
   * - `undefined` (default) → nothing
   */
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
      {/* Tri-state: `required` is only rendered when set explicitly. Required →
          red asterisk; explicitly-optional → muted "(optional)" hint; left
          undefined → no suffix (the default, for labels not tied to a field). */}
      {required === true ? (
        <span className="ml-1 text-red-600" aria-label={t('aria.required')}>
          *
        </span>
      ) : required === false ? (
        <span className="text-muted-foreground/70 ml-1 text-xs font-normal lowercase">
          ({t('optional')})
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
});
Label.displayName = LabelPrimitive.Root.displayName;
