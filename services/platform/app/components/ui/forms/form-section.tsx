'use client';

import type { ReactNode } from 'react';

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
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {(label || description) && (
        <div className="flex flex-col gap-1">
          {label && (
            <span className="text-muted-foreground text-xs font-medium md:text-sm">
              {label}
            </span>
          )}
          {description && (
            <Description className="text-xs">{description}</Description>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
