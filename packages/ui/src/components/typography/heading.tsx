'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

const headingVariants = cva('text-foreground', {
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
      '2xl': 'text-2xl',
    },
    weight: {
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },
    tracking: {
      tighter: 'tracking-tighter',
      tight: 'tracking-tight',
      normal: 'tracking-normal',
    },
  },
  defaultVariants: {
    size: 'base',
    weight: 'semibold',
  },
});

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeadingTag = `h${HeadingLevel}`;

interface HeadingProps
  extends
    HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  /** Heading level 1-6 (default: 2). */
  level?: HeadingLevel;
  /** Truncate text with ellipsis. */
  truncate?: boolean;
}

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  (
    { level = 2, size, weight, tracking, truncate, className, ...props },
    ref,
  ) => {
    const Tag: HeadingTag = `h${level}`;
    return (
      <Tag
        ref={ref}
        className={cn(
          headingVariants({ size, weight, tracking }),
          // `min-w-0` lets a truncating heading actually shrink (and therefore
          // clip with an ellipsis) when it is a flex child — e.g. a breadcrumb
          // title inside a flex header row. Without it the heading keeps its
          // full intrinsic width and overflows / wraps the row instead of
          // truncating to a single line.
          truncate && 'min-w-0 truncate',
          className,
        )}
        {...props}
      />
    );
  },
);
Heading.displayName = 'Heading';
