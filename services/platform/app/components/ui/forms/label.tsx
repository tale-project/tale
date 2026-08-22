'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { Info } from 'lucide-react';
import type { ComponentRef, ComponentPropsWithoutRef } from 'react';
import { forwardRef, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { Tooltip } from '../overlays/tooltip';

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
  /**
   * Optional hover/focus tooltip surfaced as a small `?`/info button after the
   * label. Convention: the always-visible field `description` says *what to
   * type*; `info` carries the deeper *why / format / example*. Keep it short.
   */
  info?: ReactNode;
}

export const Label = forwardRef<
  ComponentRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, required, error, info, children, ...props }, ref) => {
  const { t } = useT('common');
  const labelEl = (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-foreground text-xs leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70 md:text-sm',
        error && 'text-destructive',
        className,
      )}
      {...props}
    >
      {children}
      {/* Tri-state: `required` is only rendered when set explicitly.
          Required → no suffix (HTML required attribute carries the semantic);
          explicitly-optional → muted "(optional)" hint; left undefined → no
          suffix (the default, for labels not tied to a field). */}
      {required === false ? (
        <span className="text-muted-foreground/70 ml-1 text-xs font-normal lowercase">
          ({t('optional')})
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );

  if (!info) return labelEl;

  // Render the info affordance as a SIBLING of the <label>, not a child:
  // an interactive control inside a <label> pollutes the associated field's
  // accessible name (and steals label clicks). The tooltip is hover/focus
  // driven, so the button does no work on click.
  return (
    <span className="inline-flex items-center gap-1">
      {labelEl}
      <Tooltip content={info}>
        <button
          type="button"
          aria-label={t('aria.moreInfo')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex rounded align-middle focus-visible:ring-1 focus-visible:outline-none"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
    </span>
  );
});
Label.displayName = LabelPrimitive.Root.displayName;
