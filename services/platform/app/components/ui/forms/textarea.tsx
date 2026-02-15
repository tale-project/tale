'use client';

import { Info } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils/cn';

import { Description } from './description';
import { Label } from './label';

interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  label?: string;
  description?: React.ReactNode;
  errorMessage?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      description,
      required,
      errorMessage,
      id: providedId,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;
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
    }, [hasError, errorMessage]);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <Label htmlFor={id} required={required} error={hasError}>
            {label}
          </Label>
        )}
        <textarea
          id={id}
          className={cn(
            'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm transition-[border-color,box-shadow] duration-150',
            hasError && 'border-destructive focus-visible:ring-destructive',
            showShake && 'animate-shake',
            className,
          )}
          ref={ref}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-errormessage={hasError ? errorId : undefined}
          {...props}
        />
        {errorMessage && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="text-destructive flex items-center gap-1.5 text-sm"
          >
            <Info className="size-4" aria-hidden="true" />
            {errorMessage}
          </p>
        )}
        {description && (
          <Description id={descriptionId} className="text-xs">
            {description}
          </Description>
        )}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
