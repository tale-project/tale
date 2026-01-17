'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const stackVariants = cva('', {
  variants: {
    gap: {
      0: 'space-y-0',
      1: 'space-y-1',
      2: 'space-y-2',
      3: 'space-y-3',
      4: 'space-y-4',
      5: 'space-y-5',
      6: 'space-y-6',
      8: 'space-y-8',
      10: 'space-y-10',
      12: 'space-y-12',
    },
  },
  defaultVariants: {
    gap: 4,
  },
});

const flexVariants = cva('flex', {
  variants: {
    gap: {
      0: 'gap-0',
      1: 'gap-1',
      2: 'gap-2',
      3: 'gap-3',
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
      8: 'gap-8',
      10: 'gap-10',
      12: 'gap-12',
    },
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
      baseline: 'items-baseline',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
      around: 'justify-around',
      evenly: 'justify-evenly',
    },
  },
  defaultVariants: {
    gap: 4,
    align: 'center',
    justify: 'start',
  },
});

const gridVariants = cva('grid', {
  variants: {
    gap: {
      0: 'gap-0',
      1: 'gap-1',
      2: 'gap-2',
      3: 'gap-3',
      4: 'gap-4',
      5: 'gap-5',
      6: 'gap-6',
      8: 'gap-8',
      10: 'gap-10',
      12: 'gap-12',
    },
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-2',
      3: 'grid-cols-3',
      4: 'grid-cols-4',
      5: 'grid-cols-5',
      6: 'grid-cols-6',
    },
    sm: {
      1: 'sm:grid-cols-1',
      2: 'sm:grid-cols-2',
      3: 'sm:grid-cols-3',
      4: 'sm:grid-cols-4',
      5: 'sm:grid-cols-5',
      6: 'sm:grid-cols-6',
    },
    md: {
      1: 'md:grid-cols-1',
      2: 'md:grid-cols-2',
      3: 'md:grid-cols-3',
      4: 'md:grid-cols-4',
      5: 'md:grid-cols-5',
      6: 'md:grid-cols-6',
    },
    lg: {
      1: 'lg:grid-cols-1',
      2: 'lg:grid-cols-2',
      3: 'lg:grid-cols-3',
      4: 'lg:grid-cols-4',
      5: 'lg:grid-cols-5',
      6: 'lg:grid-cols-6',
    },
    xl: {
      1: 'xl:grid-cols-1',
      2: 'xl:grid-cols-2',
      3: 'xl:grid-cols-3',
      4: 'xl:grid-cols-4',
      5: 'xl:grid-cols-5',
      6: 'xl:grid-cols-6',
    },
  },
  defaultVariants: {
    gap: 4,
    cols: 1,
  },
});

/**
 * Stack - Vertical layout with configurable spacing
 * Default gap is 4 (16px)
 */
interface StackProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof stackVariants> {}

export const Stack = forwardRef<HTMLDivElement, StackProps>(
  ({ gap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(stackVariants({ gap }), className)}
      {...props}
    />
  ),
);
Stack.displayName = 'Stack';

/**
 * HStack - Horizontal flex layout with configurable spacing and alignment
 * Default gap is 4 (16px), items centered vertically
 */
interface HStackProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof flexVariants> {
  wrap?: boolean;
}

export const HStack = forwardRef<HTMLDivElement, HStackProps>(
  ({ gap, align, justify, wrap = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        flexVariants({ gap, align, justify }),
        wrap && 'flex-wrap',
        className,
      )}
      {...props}
    />
  ),
);
HStack.displayName = 'HStack';

/**
 * VStack - Vertical flex layout (alias for flex-col with gap)
 */
interface VStackProps
  extends
    HTMLAttributes<HTMLDivElement>,
    Omit<VariantProps<typeof flexVariants>, 'align'> {
  align?: 'start' | 'center' | 'end' | 'stretch';
}

export const VStack = forwardRef<HTMLDivElement, VStackProps>(
  ({ gap, align = 'stretch', justify, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        flexVariants({ gap, align, justify }),
        'flex-col',
        className,
      )}
      {...props}
    />
  ),
);
VStack.displayName = 'VStack';

/**
 * Grid - Responsive grid layout
 * cols: number of columns at different breakpoints
 */
interface GridProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof gridVariants> {}

export const Grid = forwardRef<HTMLDivElement, GridProps>(
  ({ cols, sm, md, lg, xl, gap, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(gridVariants({ cols, sm, md, lg, xl, gap }), className)}
      {...props}
    />
  ),
);
Grid.displayName = 'Grid';

/**
 * Center - Centers content both horizontally and vertically
 */
export const Center = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-center', className)}
    {...props}
  />
));
Center.displayName = 'Center';

/**
 * Spacer - Flexible space that expands to fill available space
 */
export const Spacer = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex-1', className)} {...props} />
));
Spacer.displayName = 'Spacer';

/**
 * NarrowContainer - Centered container with max-width 576px and horizontal padding 16px
 * Use for forms and configuration pages that need a narrow, centered layout
 */
export const NarrowContainer = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mx-auto w-full max-w-[544px] px-4', className)}
    {...props}
  />
));
NarrowContainer.displayName = 'NarrowContainer';
