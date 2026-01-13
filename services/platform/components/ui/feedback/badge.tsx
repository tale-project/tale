import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-md text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap overflow-hidden border-transparent text-primary-muted hover:bg-primary-foreground/10 pl-1.5 pr-2 py-1 text-secondary',
  {
    variants: {
      variant: {
        outline: 'border border-border',
        destructive: 'bg-red-100 hover:bg-red-100/80 text-red-800',
        orange: 'bg-orange-100 hover:bg-orange-100/80 text-orange-800',
        yellow: 'bg-yellow-100 hover:bg-yellow-100/80 text-yellow-800',
        blue: 'bg-blue-100 hover:bg-blue-100/80 text-blue-800',
        green: 'bg-green-100 hover:bg-green-100/80 text-green-800',
      },
    },
  },
);

const dotVariants = cva('size-1.5 m-1 rounded-full', {
  variants: {
    variant: {
      outline: 'bg-gray-600',
      destructive: 'bg-red-600',
      orange: 'bg-orange-600',
      yellow: 'bg-yellow-600',
      blue: 'bg-blue-600',
      green: 'bg-green-600',
    },
  },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> {
  icon?: React.ComponentType<{ className?: string }>;
  dot?: boolean;
  children: React.ReactNode;
}

export function Badge({
  className,
  variant,
  icon: Icon,
  children,
  dot,
  ...props
}: BadgeProps) {
  return (
    <div
      title={typeof children === 'string' ? children : undefined}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && (
        <div className="shrink-0 mr-1" aria-hidden="true">
          <div className={cn(dotVariants({ variant }))} />
        </div>
      )}
      {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
      <span className={cn(Icon && 'ml-1', 'truncate leading-4')}>
        {children}
      </span>
    </div>
  );
}

