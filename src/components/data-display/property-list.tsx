'use client';

import { cn } from '@tale/ui/cn';
import { Row, Stack } from '@tale/ui/layout';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

type PropertyListProps = Omit<ComponentPropsWithoutRef<typeof Stack>, 'gap'>;

/**
 * The column of a record's properties — a task's Status, Priority, Assignee,
 * dates — one `PropertyRow` each, groups split by `PropertyDivider`. Rows sit
 * 16px apart. `as` renders a landmark instead of a `div` (`as="aside"` for a
 * details panel), and anything else a panel holds (a watch toggle, an
 * archive button) can sit between the rows.
 *
 * ```tsx
 * <PropertyList as="aside" className="w-[17rem]">
 *   <PropertyRow label="Status"><StatusPicker /></PropertyRow>
 *   <PropertyRow label="Due date"><DatePicker variant="ghost" /></PropertyRow>
 *   <PropertyDivider />
 *   <PropertyRow label="Labels" stacked><LabelEditor /></PropertyRow>
 * </PropertyList>
 * ```
 */
export const PropertyList = forwardRef<HTMLDivElement, PropertyListProps>(
  (props, ref) => <Stack ref={ref} gap={4} {...props} />,
);
PropertyList.displayName = 'PropertyList';

export interface PropertyRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  /** The property's name, in the reader's language. */
  label: ReactNode;
  /** The value: a picker, a link, a line of text. */
  children: ReactNode;
  /**
   * `true` puts the label above the control at every width, for a control
   * that wraps (labels, dependencies). `'md'` stacks it only from the `md`
   * breakpoint up — where `ResponsiveDialog` turns from a phone's drawer,
   * in which the panel spans the whole sheet and a fixed-width control fits
   * beside its label, into a dialog whose narrow panel has no room for both
   * on one line. Below `md` the control moves up into the same label column
   * as the row layout.
   */
  stacked?: boolean | 'md';
  /**
   * A small control for the property itself, such as a settings button:
   * beside the name when `stacked`, at the row's end otherwise.
   */
  trailing?: ReactNode;
}

/**
 * One property: a fixed-width muted label beside its control, or above it
 * (`stacked`).
 *
 * The label WRAPS inside its column instead of overflowing it: the column is a
 * fixed width so every control lines up, and a label longer than it — which
 * English never produces but a German compound does on the first try — used to
 * paint over its own control and give the whole panel a horizontal scrollbar.
 * Wrapping keeps the field name fully readable, which truncation would not.
 * `overflow-wrap: anywhere` lets even a single compound break inside the
 * column (`break-word` would not shrink the column's minimum width, so the
 * word still overflowed wherever the browser had no hyphenation dictionary).
 * This is the SAFETY NET, not the plan: a label that needs two lines here is a
 * label to shorten per locale (`hyphens-auto` softens the break to a syllable
 * only where the browser ships a dictionary for the document's `lang`).
 */
export const PropertyRow = forwardRef<HTMLDivElement, PropertyRowProps>(
  ({ label, children, stacked, trailing, className, ...props }, ref) => {
    if (stacked) {
      const inlineBelowMd = stacked === 'md';
      return (
        <div
          ref={ref}
          className={cn(
            'flex flex-col gap-1.5',
            inlineBelowMd &&
              'flex-row items-center gap-2 md:flex-col md:items-stretch md:gap-1.5',
            className,
          )}
          {...props}
        >
          <Row
            gap={1}
            align="center"
            className={cn(
              'min-h-4',
              // The SAME label column as the row layout below, so the control
              // starts in one vertical line with the rows around it rather
              // than floating at the panel's edge.
              inlineBelowMd && 'w-20 shrink-0 md:w-auto',
            )}
          >
            <span
              className={cn(
                'text-muted-foreground text-xs font-medium',
                // Same safety net as the row layout: wrap a long label inside
                // its own column instead of shoving the control off the sheet.
                inlineBelowMd && 'wrap-anywhere hyphens-auto',
              )}
            >
              {label}
            </span>
            {trailing}
          </Row>
          <div className="w-full min-w-0">{children}</div>
        </div>
      );
    }
    // The label centres on the row's first `h-7` line — the height every value
    // control in a property column shares — rather than hanging from its top
    // edge, where it sat above the middle of a taller control. A label that
    // wraps grows the row. `shrink-0`: a panel is often a height-constrained
    // flex column, and a flex item's automatic minimum size only protects
    // text, so a fixed-height control would compress to half its height.
    return (
      <Row
        ref={ref}
        gap={2}
        align="start"
        className={cn('min-h-7 shrink-0', className)}
        {...props}
      >
        <span className="text-muted-foreground flex min-h-7 w-20 shrink-0 items-center text-xs font-medium wrap-anywhere hyphens-auto">
          {label}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
        {trailing}
      </Row>
    );
  },
);
PropertyRow.displayName = 'PropertyRow';

/** A hairline between groups of properties. Decorative: hidden from
 *  assistive technology, which reads the rows' own names. */
export const PropertyDivider = forwardRef<
  HTMLDivElement,
  Omit<HTMLAttributes<HTMLDivElement>, 'children'>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn('border-border/60 border-t', className)}
    {...props}
  />
));
PropertyDivider.displayName = 'PropertyDivider';
