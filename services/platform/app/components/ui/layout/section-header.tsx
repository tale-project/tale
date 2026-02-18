'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { Description } from '../forms/description';

const titleVariants = cva('text-foreground', {
  variants: {
    size: {
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
    },
    weight: {
      semibold: 'font-semibold',
      medium: 'font-medium',
    },
  },
  defaultVariants: {
    size: 'base',
    weight: 'semibold',
  },
});

interface SectionHeaderProps
  extends
    Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof titleVariants> {
  /** The heading text content */
  title: ReactNode;
  /** Optional description below the title */
  description?: ReactNode;
  /** Heading level for semantic HTML (default: h2) */
  as?: 'h2' | 'h3' | 'h4';
  /** Optional action element positioned to the right of the header */
  action?: ReactNode;
}

export const SectionHeader = forwardRef<HTMLDivElement, SectionHeaderProps>(
  (
    {
      title,
      description,
      size,
      weight,
      as: Tag = 'h2',
      action,
      className,
      ...props
    },
    ref,
  ) => {
    const titleContent = (
      <div className="flex flex-col gap-1">
        <Tag className={titleVariants({ size, weight })}>{title}</Tag>
        {description && (
          <Description className="text-sm">{description}</Description>
        )}
      </div>
    );

    if (action) {
      return (
        <div
          ref={ref}
          className={cn('flex items-center justify-between gap-4', className)}
          {...props}
        >
          {titleContent}
          <div className="shrink-0">{action}</div>
        </div>
      );
    }

    return (
      <div ref={ref} className={className} {...props}>
        {titleContent}
      </div>
    );
  },
);
SectionHeader.displayName = 'SectionHeader';
