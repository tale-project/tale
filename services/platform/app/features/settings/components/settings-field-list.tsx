'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

import { SettingsRow } from './settings-row';

/**
 * The shape a settings section's fields take: one divided list of rows, each
 * row carrying its label + helper text on the left and its control pinned
 * right, so a section reads as one continuous block instead of a stack of
 * loose fields. This is the structure the Organization details section
 * established; every section that edits plain values uses it.
 *
 * A row's control column is fixed-width on desktop and full-width on mobile
 * (where the row stacks), so the controls of a section line up with each other
 * regardless of how long their labels are.
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
  /** The control — rendered inside the row's fixed-width control column. */
  children: ReactNode;
  /**
   * Let the control fill the row instead of sitting in the fixed-width column
   * — for a control that needs the room (a multi-line field, a chip picker).
   */
  wideControl?: boolean;
  className?: string;
}

export function SettingsFieldRow({
  label,
  description,
  required,
  children,
  wideControl = false,
  className,
}: SettingsFieldRowProps) {
  return (
    <SettingsRow
      className={cn('py-5', className)}
      label={label}
      {...(description !== undefined ? { description } : {})}
      {...(required ? { required } : {})}
    >
      <div className={cn('w-full', !wideControl && 'sm:w-80')}>{children}</div>
    </SettingsRow>
  );
}
