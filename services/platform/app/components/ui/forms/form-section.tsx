'use client';

import { Description } from '@tale/ui/description';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

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
              className="text-foreground text-xs font-medium md:text-sm"
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
