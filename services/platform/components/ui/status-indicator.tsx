'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusIndicatorProps extends HTMLAttributes<HTMLDivElement> {
  /** The status variant to display */
  variant?: StatusVariant;
  /** Whether to animate the indicator (pulse effect) */
  pulse?: boolean;
  /** Size of the indicator dot */
  size?: 'sm' | 'md' | 'lg';
  /** Text to display next to the indicator */
  children?: React.ReactNode;
}

const variantClasses: Record<StatusVariant, string> = {
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-gray-400',
};

const textVariantClasses: Record<StatusVariant, string> = {
  success: 'text-green-600',
  warning: 'text-amber-600',
  error: 'text-red-600',
  info: 'text-blue-600',
  neutral: 'text-gray-600',
};

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

const StatusIndicator = forwardRef<HTMLDivElement, StatusIndicatorProps>(
  (
    {
      variant = 'success',
      pulse = false,
      size = 'md',
      children,
      className,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center space-x-2 text-sm',
        textVariantClasses[variant],
        className
      )}
      {...props}
    >
      <div
        className={cn(
          'rounded-full',
          variantClasses[variant],
          sizeClasses[size],
          pulse && 'animate-pulse'
        )}
        aria-hidden="true"
      />
      {children && <span>{children}</span>}
    </div>
  )
);
StatusIndicator.displayName = 'StatusIndicator';

export { StatusIndicator };
export type { StatusVariant };
