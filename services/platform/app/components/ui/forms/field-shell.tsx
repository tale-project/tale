'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/**
 * The frame every labelled form control renders inside: label + description on
 * one side, the control and its error on the other.
 *
 * Orientation is decided by the SURFACE, not the call site. A container marks
 * itself with `data-field-layout="row"` (see {@link FIELD_LAYOUT_ROW}) and
 * every field beneath it lays the label on the left and the control on the
 * right from `sm` up — the rhythm settings rows already had. Everywhere else
 * fields stack, which is what a narrow column or a dialog needs.
 *
 * The switch is pure CSS (`in-data-*` = "has such an ancestor"), so it costs no
 * context and — because dialogs portal to `document.body` — a dialog rendered
 * from a row-layout page correctly stacks its fields again.
 *
 * Reading order is label → description → control → error in BOTH orientations,
 * which is the order `design/docs/app.md` mandates.
 */

/** Spread onto a container whose fields should read label-left/control-right. */
export const FIELD_LAYOUT_ROW = { 'data-field-layout': 'row' } as const;

// Applied to the outer frame: stacked by default, two columns under a
// row-layout container.
const FRAME_ROW =
  'in-data-[field-layout=row]:sm:flex-row in-data-[field-layout=row]:sm:items-start in-data-[field-layout=row]:sm:justify-between in-data-[field-layout=row]:sm:gap-6';

// The label column only exists in row mode; stacked, it is just the first
// block of the frame.
const LABEL_COLUMN_ROW =
  'in-data-[field-layout=row]:sm:max-w-xs in-data-[field-layout=row]:sm:shrink-0 in-data-[field-layout=row]:sm:pt-2';

// The control column is the settings control width — the same 20rem column
// `SettingsFieldRow` pins its controls to, so every field on a page lines up
// regardless of which wrapper framed it.
const CONTROL_COLUMN_ROW =
  'in-data-[field-layout=row]:sm:w-80 in-data-[field-layout=row]:sm:shrink-0';

export interface FieldShellProps {
  /** The rendered `<Label>`, when the field has one. */
  label?: ReactNode;
  /** The rendered `<Description>` — sits under the label. */
  description?: ReactNode;
  /** The rendered error paragraph — sits under the control. */
  error?: ReactNode;
  /** The control itself. */
  children: ReactNode;
  /** Extra classes for the outer frame (the controls' `wrapperClassName`). */
  className?: string;
  /**
   * Keep the control column full width in row mode — for a control that needs
   * the room (a tall textarea, a JSON editor, a table-like picker).
   */
  wideControl?: boolean;
}

export function FieldShell({
  label,
  description,
  error,
  children,
  className,
  wideControl = false,
}: FieldShellProps) {
  const hasLabelColumn = label !== undefined || description !== undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', FRAME_ROW, className)}>
      {hasLabelColumn && (
        <div className={cn('flex flex-col gap-1', LABEL_COLUMN_ROW)}>
          {label}
          {description}
        </div>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5',
          !wideControl && CONTROL_COLUMN_ROW,
          wideControl && 'in-data-[field-layout=row]:sm:w-full',
        )}
      >
        {children}
        {error}
      </div>
    </div>
  );
}
