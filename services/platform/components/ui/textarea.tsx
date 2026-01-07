'use client';

import * as React from 'react';

import { cn } from '@/lib/utils/cn';
import { Label } from './label';

interface TextareaProps extends React.ComponentPropsWithoutRef<'textarea'> {
  label?: string;
  errorMessage?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, required, errorMessage, id: providedId, ...props }, ref) => {
    const generatedId = React.useId();
    const id = providedId ?? generatedId;
    const hasError = !!errorMessage;

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
            'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            hasError && 'border-destructive focus-visible:ring-destructive',
            className,
          )}
          ref={ref}
          required={required}
          aria-invalid={hasError}
          {...props}
        />
        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

