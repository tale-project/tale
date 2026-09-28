'use client';

import { cn } from '@tale/ui/cn';
import { FIELD_ROW_CONTROL } from '@tale/ui/field-shell';
import type { HTMLAttributes, ReactNode } from 'react';

import { SettingsRow, type SettingsRowChildren } from './settings-row';

/**
 * The shape a settings section's fields take: one divided list of rows, each
 * row carrying its label + helper text and its control, so a section reads as
 * one continuous block instead of a stack of loose fields. Default row layout
 * is label-left / control-right (the Organization details pattern); pass
 * `layout="stack"` for label-above-control in dialogs and narrow panes.
 *
 * In row layout, a row's control column is fixed-width while the row is a row
 * and full-width once it stacks (a narrow surface), so the controls of a
 * section line up with each other regardless of how long their labels are.
 * Stack layout always uses the full width under the label.
 *
 * The row's wrapper is a plain `<div>`, so its label and help name and
 * describe nothing by themselves: pass the control as a function of the row's
 * ids and point the control at them —
 *
 *   <SettingsFieldRow label={…} description={…}>
 *     {({ labelId, descriptionId }) => (
 *       <Input aria-labelledby={labelId} aria-describedby={descriptionId} />
 *     )}
 *   </SettingsFieldRow>
 */

export function SettingsFieldList({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('divide-border divide-y', className)} {...props}>
      {children}
    </div>
  );
}

export interface SettingsFieldRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Append a red required asterisk to the label. */
  required?: boolean;
  /**
   * `'row'` (default) — label left / control right once the settings surface
   * has room for both (see `SettingsRow`).
   * `'stack'` — always label above control; control is full width.
   */
  layout?: 'row' | 'stack';
  /**
   * The control — rendered inside the row's fixed-width control column. A
   * function receives the row's label and help ids (`SettingsRowControlIds`)
   * for the control's `aria-labelledby` / `aria-describedby`.
   */
  children: SettingsRowChildren;
  /**
   * Let the control fill the row instead of sitting in the fixed-width column
   * — for a control that needs the room (a multi-line field, a chip picker).
   * Implied when `layout="stack"`.
   */
  wideControl?: boolean;
  className?: string;
}

export function SettingsFieldRow({
  label,
  description,
  required,
  layout = 'row',
  children,
  wideControl = false,
  className,
}: SettingsFieldRowProps) {
  const fullWidthControl = wideControl || layout === 'stack';

  return (
    <SettingsRow
      className={cn('py-5', className)}
      label={label}
      layout={layout}
      // A stable marker to find the row by (tests, styles) — instead of the
      // wrapper's ARIA attributes or its utility classes.
      data-settings-field-row=""
      {...(description !== undefined ? { description } : {})}
      {...(required ? { required } : {})}
    >
      {(ids) => (
        <div className={cn('w-full', !fullWidthControl && FIELD_ROW_CONTROL)}>
          {typeof children === 'function' ? children(ids) : children}
        </div>
      )}
    </SettingsRow>
  );
}
