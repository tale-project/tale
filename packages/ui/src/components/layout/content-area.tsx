'use client';

import { cn } from '@tale/ui/cn';
import { FIELD_LAYOUT_ROW } from '@tale/ui/field-shell';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';

/**
 * Applied LAST in `cn()` so call-site `py-*` / `pb-*` cannot drop dock
 * clearance (agent tabs pass `className="… py-4"` which would otherwise
 * replace the variant bottom padding and hide `--mobile-floating-actions-pad`).
 *
 * Base size is `--content-area-pb`, declared once on the shared class.
 */
const FLOATING_DOCK_END_PAD =
  'pb-[calc(var(--content-area-pb)+var(--mobile-floating-actions-pad,0px))]';

/**
 * The inset every content frame keeps, on all four sides: `pt-4` / `px-4` /
 * this token. ONE number, not one per variant — a bounded frame (the
 * automation workbench, an overview table) shows its bottom edge and its top
 * edge at the same time, so an inset that differs by side reads as a mistake;
 * a scrolling frame ends on the same measure it started with. `panel` widens
 * the sides to `px-6` for its own chrome; nothing else varies.
 */
const contentAreaVariants = cva(
  'flex w-full min-w-0 flex-col [--content-area-pb:1rem]',
  {
    variants: {
      variant: {
        page: 'px-4 pt-4',
        // The overview-list measure: ONE frame for every collection screen
        // (Automations, Projects, the Knowledge tables). `min-h-0 flex-1`
        // bounds the height against the page shell, which is what a
        // `DataTable stickyLayout` measures itself against — so the toolbar,
        // the header row and the footer stay put and only the rows scroll,
        // inside the table's own scrollport. Without it the table grows and
        // the PAGE scrolls instead, which is the drift this variant exists to
        // prevent. Anything else the page stacks above the table (a folder
        // breadcrumb, a load-failure alert) is a sibling inside this frame.
        list: 'min-h-0 flex-1 px-4 pt-4',
        // `max-w-3xl` is the settings measure (`SettingsPage`, #2567): every
        // configuration surface — org settings, project tabs, automation
        // settings — shares one content width so switching between them
        // doesn't reflow the reading column.
        narrow: 'mx-auto max-w-3xl px-4 pt-4',
        panel: 'px-6 pt-4',
      },
      gap: {
        3: 'gap-3',
        4: 'gap-4',
        5: 'gap-5',
        6: 'gap-6',
        8: 'gap-8',
      },
    },
    defaultVariants: {
      variant: 'page',
      gap: 6,
    },
  },
);

interface ContentAreaProps
  extends
    HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof contentAreaVariants> {}

export const ContentArea = forwardRef<HTMLDivElement, ContentAreaProps>(
  ({ variant, gap, className, ...props }, ref) => (
    <div
      ref={ref}
      // `narrow` is the configuration measure (project tabs, and anything else
      // that shares the settings width), so it also declares the settings field
      // layout: label left, control right from `sm` up — see `FieldShell`.
      {...(variant === 'narrow' ? FIELD_LAYOUT_ROW : {})}
      className={cn(
        contentAreaVariants({ variant, gap }),
        className,
        FLOATING_DOCK_END_PAD,
      )}
      {...props}
    />
  ),
);
ContentArea.displayName = 'ContentArea';
