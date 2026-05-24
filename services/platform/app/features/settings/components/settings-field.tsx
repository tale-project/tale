'use client';

import { Description } from '@tale/ui/description';
import { Info } from 'lucide-react';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

import { Label } from '@/app/components/ui/forms/label';
import { cn } from '@/lib/utils/cn';

interface SettingsFieldProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  label?: ReactNode;
  description?: ReactNode;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  /** Width preset for the control. `sm` is the default for most inputs. */
  width?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
}

const widthClass: Record<NonNullable<SettingsFieldProps['width']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  full: 'w-full',
};

export const SettingsField = forwardRef<HTMLDivElement, SettingsFieldProps>(
  (
    {
      label,
      description,
      error,
      required,
      htmlFor,
      width = 'sm',
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const id = useId();
    const descId = description ? `${id}-desc` : undefined;
    const errorId = error ? `${id}-err` : undefined;

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1.5', widthClass[width], className)}
        {...props}
      >
        {label && (
          <Label htmlFor={htmlFor} required={required} error={!!error}>
            {label}
          </Label>
        )}
        <div
          aria-describedby={
            [descId, errorId].filter(Boolean).join(' ') || undefined
          }
        >
          {children}
        </div>
        {error && (
          <p
            id={errorId}
            role="alert"
            aria-live="polite"
            className="text-destructive flex items-center gap-1.5 text-sm"
          >
            <Info className="size-4" aria-hidden="true" />
            {error}
          </p>
        )}
        {description && !error && (
          <Description id={descId} className="text-xs">
            {description}
          </Description>
        )}
      </div>
    );
  },
);
SettingsField.displayName = 'SettingsField';
