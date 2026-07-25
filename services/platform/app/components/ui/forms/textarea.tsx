'use client';

import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Info } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils/cn';

import { FieldShell } from './field-shell';
import { Label } from './label';

interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
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
}

// Plain control — the real textarea field. No skeleton logic of its own.
const TextareaBase = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      description,
      required,
      errorMessage,
      counterMax,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;

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
        <textarea
          id={id}
          className={cn(
            'border-(--color-border-input) bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-base transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
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

/**
 * Skeleton-aware Textarea. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — the real field is laid out
 * invisibly to set the exact height (incl. `rows`), with a pulse overlay on
 * top, so the skeleton can never drift from the live control.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (props, ref) => {
    const loading = useSkeleton();
    if (loading) {
      return (
        <SkeletonBox>
          <TextareaBase {...props} ref={ref} />
        </SkeletonBox>
      );
    }
    return <TextareaBase {...props} ref={ref} />;
  },
);
Textarea.displayName = 'Textarea';
