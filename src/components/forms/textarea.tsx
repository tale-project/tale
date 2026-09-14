'use client';

import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Info } from 'lucide-react';
import * as React from 'react';

import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../overlays/disabled-reason';
import { FieldShell } from './field-shell';
import { Label } from './label';

export interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  label?: string;
  description?: React.ReactNode;
  errorMessage?: string;
  /**
   * Render a `used / max` character counter under the control, owned by the
   * field itself so every surface places it identically. Display-only — it
   * does not cap input (pair with validation); the count turns destructive
   * past the max.
   */
  counterMax?: number;
  /**
   * Span the full row in the settings row layout instead of the standard
   * control column — for a tall textarea that IS the section's whole body.
   */
  wideControl?: boolean;
  /**
   * Fill the height the flex parent grants (see `FieldShell`): the textarea
   * stretches to the remaining pane space and scrolls internally — for an
   * editor-style body rather than a form field.
   */
  fillHeight?: boolean;
  /** Extra classes for the field's outer frame (mirrors `Input`). */
  wrapperClassName?: string;
  /**
   * Explains *why* the field is disabled, surfaced in a tooltip on hover AND
   * focus and to screen readers. Only takes effect while the field is
   * `disabled`; ignored otherwise, so callers can pass it unconditionally.
   * Mirrors `Input`: the field stays focusable and `readOnly` with
   * `aria-disabled` instead of the native attribute.
   */
  disabledReason?: React.ReactNode;
}

// Keep the textarea's native dimensions and value while its surface is masked.
const TextareaBase = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      description,
      required,
      errorMessage,
      counterMax,
      wideControl,
      fillHeight,
      wrapperClassName,
      disabled,
      disabledReason,
      readOnly,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;
    // Soft-disable keeps the field focusable + hoverable (so the reason tooltip
    // reaches pointer and keyboard users) while `readOnly` blocks edits.
    const softDisabled = Boolean(disabled) && hasDisabledReason(disabledReason);

    // The live character count for the counter. Reconciled from the DOM
    // after every render (not just onChange) because form libraries reset
    // values programmatically without firing events; the state-equality
    // bail-out keeps this loop-free.
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [charCount, setCharCount] = React.useState(0);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- deliberately deps-less: it reconciles the counter with the DOM value after EVERY render, because form resets change the value without an event; the setState equality bail-out keeps it loop-free
    React.useEffect(() => {
      if (counterMax === undefined) return;
      setCharCount(innerRef.current?.value.length ?? 0);
    });
    const descriptionId = `${id}-description`;
    const hasError = !!errorMessage;
    const describedBy =
      [description && descriptionId, hasError && errorId]
        .filter(Boolean)
        .join(' ') || undefined;
    const [showShake, setShowShake] = React.useState(false);

    // Trigger shake animation when error appears
    React.useEffect(() => {
      if (hasError) {
        setShowShake(true);
        const timer = setTimeout(() => setShowShake(false), 400);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [hasError, errorMessage]);

    return (
      <FieldShell
        {...(wideControl !== undefined ? { wideControl } : {})}
        {...(fillHeight !== undefined ? { fillHeight } : {})}
        {...(wrapperClassName !== undefined
          ? { className: wrapperClassName }
          : {})}
        {...(label !== undefined
          ? {
              label: (
                <Label htmlFor={id} required={required} error={hasError}>
                  {label}
                </Label>
              ),
            }
          : {})}
        {...(description !== undefined
          ? {
              description: (
                <Description id={descriptionId}>{description}</Description>
              ),
            }
          : {})}
        {...(errorMessage !== undefined
          ? {
              error: (
                <p
                  id={errorId}
                  role="alert"
                  aria-live="polite"
                  className="text-destructive flex items-center gap-1.5 text-sm"
                >
                  <Info className="size-4" aria-hidden="true" />
                  {errorMessage}
                </p>
              ),
            }
          : {})}
      >
        <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
          <SkeletonBox asChild>
            <textarea
              id={id}
              disabled={softDisabled ? undefined : disabled}
              aria-disabled={softDisabled || undefined}
              readOnly={softDisabled ? true : readOnly}
              className={cn(
                'bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[120px] w-full rounded-md border border-(--color-border-input) px-3 py-2 text-base transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
                fillHeight && 'min-h-0 flex-1 resize-none',
                hasError && 'border-destructive focus-visible:ring-destructive',
                showShake && 'animate-shake',
                className,
              )}
              ref={(node) => {
                innerRef.current = node;
                if (typeof ref === 'function') {
                  ref(node);
                } else if (ref) {
                  ref.current = node;
                }
              }}
              required={required}
              aria-invalid={hasError || undefined}
              aria-describedby={describedBy}
              aria-errormessage={hasError ? errorId : undefined}
              {...props}
            />
          </SkeletonBox>
        </DisabledReasonTooltip>
        {counterMax !== undefined && (
          <p
            className={cn(
              'text-muted-foreground text-xs',
              charCount > counterMax && 'text-destructive',
            )}
          >
            {charCount} / {counterMax}
          </p>
        )}
      </FieldShell>
    );
  },
);
TextareaBase.displayName = 'TextareaBase';

// Keep the same control tree while its own surface is masked.
export const Textarea = TextareaBase;
Textarea.displayName = 'Textarea';
