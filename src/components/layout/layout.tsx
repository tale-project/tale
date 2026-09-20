'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ElementType, forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

/**
 * The single spacing scale shared by every layout primitive (`Stack`, `Row`,
 * `Grid`) and re-used by `ActionRow` and `PageSection`. One scale, one source of
 * truth — pick a named step, never a raw `gap-[…]`.
 *
 * Recommended steps for app layout: `2` (field groups: label → control → hint),
 * `4` (within a section — the default), `6` (loose grouping inside a wide
 * section), `8` (between sections / the settings rhythm). `5`, `10` and `12`
 * remain for legacy callers; avoid them in new code.
 */
export const gapScale = {
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
} as const;

const alignVariants = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const justifyVariants = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
} as const;

const stackVariants = cva('flex flex-col', {
  variants: {
    gap: gapScale,
    align: alignVariants,
    justify: justifyVariants,
  },
  defaultVariants: {
    gap: 4,
    align: 'stretch',
    justify: 'start',
  },
});

const rowVariants = cva('flex flex-row', {
  variants: {
    gap: gapScale,
    align: alignVariants,
    justify: justifyVariants,
  },
  defaultVariants: {
    gap: 4,
    align: 'center',
    justify: 'start',
  },
});

const gridVariants = cva('grid', {
  variants: {
    gap: gapScale,
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

/** Semantic elements a layout primitive may render as (`<Stack as="ul">`). */
type LayoutElement =
  | 'div'
  | 'section'
  | 'article'
  | 'aside'
  | 'header'
  | 'footer'
  | 'main'
  | 'nav'
  | 'ul'
  | 'ol'
  | 'li'
  | 'form'
  | 'fieldset';

interface PolymorphicProps {
  /**
   * Render a semantic element instead of the default `div` — use this to keep
   * pages composing primitives rather than dropping to raw HTML (`as="ul"` for a
   * list, `as="form"` for a form, `as="section"` for a landmark).
   */
  as?: LayoutElement;
  /**
   * Merge layout classes onto the single child element instead of rendering a
   * wrapper. Mutually exclusive with `as`.
   */
  asChild?: boolean;
}

interface StackProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof stackVariants>,
    PolymorphicProps {
  /** Allow items to wrap onto multiple lines. */
  wrap?: boolean;
}

/**
 * Stack — the canonical **vertical** layout primitive: `flex-col` with a named
 * `gap`. Defaults to `gap={4}` (16px) and `align="stretch"` so children fill the
 * width. Use for stacked sections, fields, and cards instead of a raw
 * `<div className="flex flex-col gap-…">`.
 */
export const Stack = forwardRef<HTMLDivElement, StackProps>(
  (
    {
      gap,
      align,
      justify,
      wrap = false,
      as = 'div',
      asChild = false,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp: ElementType = asChild ? Slot : as;
    return (
      <Comp
        ref={ref}
        className={cn(
          stackVariants({ gap, align, justify }),
          wrap && 'flex-wrap',
          className,
        )}
        {...props}
      />
    );
  },
);
Stack.displayName = 'Stack';

interface RowProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof rowVariants>,
    PolymorphicProps {
  /** Allow items to wrap onto multiple lines. */
  wrap?: boolean;
}

/**
 * Row — the canonical **horizontal** layout primitive: `flex-row` with a named
 * `gap`. Defaults to `gap={4}` (16px) and `align="center"`. Use for inline
 * groups (icon + label, control clusters) instead of a raw
 * `<div className="flex items-center gap-…">`. For a cluster of action buttons,
 * prefer the semantic `ActionRow`.
 */
export const Row = forwardRef<HTMLDivElement, RowProps>(
  (
    {
      gap,
      align,
      justify,
      wrap = false,
      as = 'div',
      asChild = false,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp: ElementType = asChild ? Slot : as;
    return (
      <Comp
        ref={ref}
        className={cn(
          rowVariants({ gap, align, justify }),
          wrap && 'flex-wrap',
          className,
        )}
        {...props}
      />
    );
  },
);
Row.displayName = 'Row';

/**
 * @deprecated Use `Row` — the canonical horizontal layout primitive. Kept as an
 * alias so existing call sites keep working; new code should import `Row`.
 */
export const HStack = Row;

/**
 * @deprecated Use `Stack` — the canonical vertical layout primitive. Kept as an
 * alias so existing call sites keep working; new code should import `Stack`.
 */
export const VStack = Stack;

interface GridProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gridVariants>,
    PolymorphicProps {}

/**
 * Grid — responsive grid layout. `cols` controls the column count, with
 * per-breakpoint overrides (`sm`, `md`, `lg`, `xl`). Shares the one `gap` scale.
 */
export const Grid = forwardRef<HTMLDivElement, GridProps>(
  (
    {
      cols,
      sm,
      md,
      lg,
      xl,
      gap,
      as = 'div',
      asChild = false,
      className,
      ...props
    },
    ref,
  ) => {
    const Comp: ElementType = asChild ? Slot : as;
    return (
      <Comp
        ref={ref}
        className={cn(gridVariants({ cols, sm, md, lg, xl, gap }), className)}
        {...props}
      />
    );
  },
);
Grid.displayName = 'Grid';

/** Center — centers content both horizontally and vertically. */
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

/** Spacer — flexible space that expands to fill available space. */
export const Spacer = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex-1', className)} {...props} />
));
Spacer.displayName = 'Spacer';

/**
 * NarrowContainer — centered container with a 544px max-width and 16px
 * horizontal padding. Use for forms and configuration pages.
 */
export const NarrowContainer = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('mx-auto w-full max-w-136 px-4', className)}
    {...props}
  />
));
NarrowContainer.displayName = 'NarrowContainer';
