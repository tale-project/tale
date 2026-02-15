'use client';

import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { Description } from './description';

interface FormSectionProps {
  label?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function FormSection({
  label,
  description,
  children,
  className,
}: FormSectionProps) {
  const id = useId();

  return (
    <div
      role="group"
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      className={cn('flex flex-col gap-3', className)}
    >
      {(label || description) && (
        <div className="flex flex-col gap-1">
          {label && (
            <span
              id={`${id}-label`}
              className="text-muted-foreground text-xs font-medium md:text-sm"
            >
              {label}
            </span>
          )}
          {description && (
            <Description id={`${id}-desc`} className="text-xs">
              {description}
            </Description>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
