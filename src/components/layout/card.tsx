'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { type ComponentProps, forwardRef, type HTMLAttributes } from 'react';

import { cn } from '../../lib/cn';
import { Grid } from './layout';

/**
 * Card — the one bordered surface primitive for the whole app. Compose it with
 * the `Card*` subcomponents (header/title/description/content/footer/media) or
 * use it as a bare frame. Every "card-like" surface (catalogs, settings panels,
 * chat approvals, kanban tasks, dashboards) is one of these with a different
 * `padding`/`radius`/`interactive` combination — never a hand-rolled
 * `rounded-* border bg-* p-*` div.
 *
 * Surfaces use the canonical design tokens (`bg-bg-base`/`border-border-base`/
 * `text-fg-*`), matching Button/Badge and the markdown Card.
 */
export const cardVariants = cva(
  'bg-bg-base text-fg-base border-border-base border transition-[colors,box-shadow]',
  {
    variants: {
      /**
       * Inner padding. `none` lets the caller own padding (e.g. a full-bleed
       * inner button or a list of self-padded rows). Steps map to the real
       * surfaces: `sm` kanban task, `md` chat approval, `lg` mcp/stat cell,
       * `xl` classic card.
       */
      padding: { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5', xl: 'p-6' },
      radius: { lg: 'rounded-lg', xl: 'rounded-xl' },
      shadow: { none: '', sm: 'shadow-sm', md: 'shadow-md' },
      /**
       * Adds a hover border lift + a focus ring. The focus ring only renders on
       * the focused element, so it's meaningful when the card IS the
       * interactive node (`asChild` around a `<button>`/`<a>`) and inert (but
       * harmless) on a plain `<div>` card.
       */
      interactive: {
        true: 'hover:border-border-strong focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none',
        false: '',
      },
    },
    defaultVariants: {
      padding: 'xl',
      radius: 'lg',
      shadow: 'none',
      interactive: false,
    },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /**
   * Render as a Radix `Slot` so the card's styling merges onto its single child
   * — use it to turn the card into a `<button>`, `<a>`, or router `<Link>`.
   */
  asChild?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { asChild, padding, radius, shadow, interactive, className, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(
          cardVariants({ padding, radius, shadow, interactive }),
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = 'Card';

/** Vertical header stack (title + description). Padding is owned by `Card`. */
export const CardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1.5', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

/**
 * Card title — an `<h3>` by default (keeps heading order sane). Clamping is
 * per-surface, so it's intentionally NOT baked in here; add `line-clamp-*` via
 * `className` where a surface needs it.
 */
export const CardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => {
  // Render through a tag variable (like `Heading`) so the content — passed as
  // `children` via `...props` — isn't flagged as an empty heading.
  const Tag = 'h3';
  return (
    <Tag
      ref={ref}
      className={cn(
        'text-fg-base leading-none font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  );
});
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-fg-muted text-sm', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/** Body slot. Carries no styling of its own — pure structure. */
export const CardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props} />
));
CardContent.displayName = 'CardContent';

/** Footer row — actions sit here. */
export const CardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center gap-2', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

/**
 * A 40px bordered media tile for a card (brand glyph, icon, or avatar) so icon
 * sizing is identical everywhere. Render an `<Image>`/`<Icon>` (≈24px) inside.
 */
export const CardMedia = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      'border-border-base bg-bg-base flex size-10 shrink-0 items-center justify-center rounded-lg border',
      className,
    )}
    {...props}
  />
));
CardMedia.displayName = 'CardMedia';

export interface CardGridProps extends Omit<
  ComponentProps<typeof Grid>,
  'cols' | 'sm' | 'md' | 'lg' | 'xl'
> {
  cols?: ComponentProps<typeof Grid>['cols'];
}

/**
 * Responsive card grid for the browse-and-act surfaces (catalogs, apps). Columns
 * scale with the grid's OWN width via container queries, not the viewport, so a
 * card stays ~290px+ whether the grid sits full-bleed or in a sidebar-narrowed
 * panel, and caps at 4 columns so cards keep breathing room (titles never
 * truncate): 1 → 2 (≥36rem) → 3 (≥56rem) → 4 (≥80rem), gap-4. The enclosing
 * `@container` makes the inner grid query that width. Column counts are
 * utilities (not `Grid` props) because container breakpoints have no
 * viewport-prop equivalent.
 */
export const CardGrid = forwardRef<HTMLDivElement, CardGridProps>(
  ({ cols = 1, gap = 4, className, ...props }, ref) => (
    <div className="@container">
      <Grid
        ref={ref}
        cols={cols}
        gap={gap}
        className={cn(
          '@xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4',
          className,
        )}
        {...props}
      />
    </div>
  ),
);
CardGrid.displayName = 'CardGrid';
