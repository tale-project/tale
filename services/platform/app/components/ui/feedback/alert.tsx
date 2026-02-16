'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentType, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

const alertVariants = cva(
  'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning: 'border-amber-500/50 text-amber-600 [&>svg]:text-amber-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

interface AlertProps extends VariantProps<typeof alertVariants> {
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Urgency level for screen reader announcement */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

export function Alert({
  variant,
  icon: Icon,
  title,
  description,
  children,
  live = 'polite',
  className,
}: AlertProps) {
  return (
    <div
      role="alert"
      aria-live={live}
      aria-atomic="true"
      className={cn(alertVariants({ variant }), className)}
    >
      {Icon && <Icon className="size-4" aria-hidden="true" />}
      {title && (
        <h5 className="mb-1 leading-none font-medium tracking-tight">
          {title}
        </h5>
      )}
      {description && (
        <div className="text-sm [&_p]:leading-relaxed">{description}</div>
      )}
      {children}
    </div>
  );
}
