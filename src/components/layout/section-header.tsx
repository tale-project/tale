'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
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

export interface SectionHeaderProps
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
    // Title and action share one row; description always spans the full width
    // below. Putting the description beside a trailing action squeezed long
    // copy into a narrow column (e.g. a node inspector with a long type badge).
    // `max-w-prose` still caps the measure — full width is about escaping the
    // title column, not about letting a line run the width of the page.
    if (action) {
      return (
        <div
          ref={ref}
          className={cn('flex flex-col gap-1', className)}
          {...props}
        >
          <div className="flex items-start justify-between gap-4">
            <Tag
              className={cn(titleVariants({ size, weight }), 'min-w-0 flex-1')}
            >
              {title}
            </Tag>
            <div className="shrink-0">{action}</div>
          </div>
          {description ? (
            <Description className="max-w-prose text-sm">
              {description}
            </Description>
          ) : null}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1', className)}
        {...props}
      >
        <Tag className={titleVariants({ size, weight })}>{title}</Tag>
        {description ? (
          <Description className="max-w-prose text-sm">
            {description}
          </Description>
        ) : null}
      </div>
    );
  },
);
SectionHeader.displayName = 'SectionHeader';
