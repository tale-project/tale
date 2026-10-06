'use client';

import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

/**
 * The frame every labelled form control renders inside: label + description on
 * one side, the control and its error on the other.
 *
 * Orientation is decided by the SURFACE, not the call site. A container marks
 * itself with `data-field-layout="row"` (see {@link FIELD_LAYOUT_ROW}) and
 * every field beneath it lays the label on the left and the control on the
 * right — the rhythm settings rows already had. Everywhere else fields stack,
 * which is what a narrow column or a dialog needs.
 *
 * "Room for a row" is a question about the SURFACE's width, not the
 * viewport's: the marker also makes the element a named size container
 * (`field-layout`, declared in `globals.css`), and a row forms only while that
 * box holds the 20rem control, the gap and a readable label column (36rem).
 * A viewport breakpoint could not tell them apart — a 1024px window whose
 * settings column sits beside the rail and the settings panel is 400px wide,
 * and its rows used to squeeze their labels to one word per line.
 *
 * The switch is pure CSS, so it costs no context and — because dialogs portal
 * to `document.body`, out of every such container — a dialog rendered from a
 * row-layout page correctly stacks its fields again.
 *
 * Reading order is label → description → control → error in BOTH orientations,
 * which is the order `design/docs/app.md` mandates.
 */

/** Spread onto a container whose fields should read label-left/control-right. */
export const FIELD_LAYOUT_ROW = { 'data-field-layout': 'row' } as const;

/**
 * The frame of a label-left/control-right row: stacked by default, two
 * columns once the nearest row-layout container is 36rem wide. Shared with
 * the platform's settings rows so every row on a page turns at the same width.
 */
export const FIELD_ROW_FRAME =
  '@xl/field-layout:flex-row @xl/field-layout:items-start @xl/field-layout:justify-between @xl/field-layout:gap-6';

/**
 * The control column of a row: the settings control width (20rem), fixed, so
 * every control on a page lines up whatever its label — `SettingsFieldRow`
 * pins its controls to the same column. Stacked, the control takes the width.
 */
export const FIELD_ROW_CONTROL =
  '@xl/field-layout:w-80 @xl/field-layout:shrink-0';

// The label column only exists in row mode; stacked, it is just the first
// block of the frame. It yields width before the control does (`min-w-0`):
// a long label or description wraps instead of pushing the row past its box.
const LABEL_COLUMN_ROW =
  '@xl/field-layout:max-w-xs @xl/field-layout:min-w-0 @xl/field-layout:pt-2';

// A wide control fills what the label leaves rather than claiming the full
// row, so the label keeps its natural width (up to `max-w-xs`).
const WIDE_CONTROL_ROW = '@xl/field-layout:min-w-0 @xl/field-layout:flex-1';

export interface FieldShellProps {
  /** The rendered `<Label>`, when the field has one. */
  label?: ReactNode;
  /** The rendered `<Description>` — sits under the label. */
  description?: ReactNode;
  /** A hint rendered below the control (above the error) — for notes that make sense after seeing the input. */
  hint?: ReactNode;
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
  /**
   * Let the control fill the height its flex parent grants — for the one
   * control that IS a pane's body (the skill editor's markdown textarea).
   * Threads `min-h-0 flex-1` through the frame and the control column, which
   * otherwise size to content and would swallow the parent's height.
   */
  fillHeight?: boolean;
}

export function FieldShell({
  label,
  description,
  hint,
  error,
  children,
  className,
  wideControl = false,
  fillHeight = false,
}: FieldShellProps) {
  const hasLabelColumn = label !== undefined || description !== undefined;

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5',
        FIELD_ROW_FRAME,
        fillHeight && 'min-h-0 flex-1',
        className,
      )}
    >
      {hasLabelColumn && (
        <div className={cn('flex flex-col gap-1', LABEL_COLUMN_ROW)}>
          {label}
          {description}
        </div>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-1.5',
          wideControl ? WIDE_CONTROL_ROW : FIELD_ROW_CONTROL,
          fillHeight && 'min-h-0 flex-1',
        )}
      >
        {children}
        {hint}
        {error}
      </div>
    </div>
  );
}
