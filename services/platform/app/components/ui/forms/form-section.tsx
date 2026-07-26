'use client';

import { Description } from '@tale/ui/description';
import { useId, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface FormSectionProps extends HTMLAttributes<HTMLDivElement> {
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
  ...props
}: FormSectionProps) {
  const id = useId();

  return (
    <div
      role="group"
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      className={cn('flex flex-col gap-3', className)}
      {...props}
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
            <Description id={`${id}-desc`}>{description}</Description>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
