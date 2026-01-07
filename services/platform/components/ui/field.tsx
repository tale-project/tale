'use client';

import { forwardRef, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Stack } from './layout';

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** The label to display above the value */
  label: string;
  /** The value to display - can be text or custom ReactNode */
  children: ReactNode;
}

/**
 * Field - Displays a labeled value pair for read-only data display
 * Use for showing information in detail views, modals, and info panels
 *
 * ## Example:
 * ```tsx
 * <Field label="Email">john@example.com</Field>
 * <Field label="Status"><Badge>Active</Badge></Field>
 * ```
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(
  ({ label, children, className, ...props }, ref) => (
    <div ref={ref} className={className} {...props}>
      <h4 className="text-sm font-medium text-muted-foreground mb-1">
        {label}
      </h4>
      <div>{children}</div>
    </div>
  ),
);
Field.displayName = 'Field';

interface FieldGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Gap between fields (1-12, maps to Tailwind gap) */
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
}

/**
 * FieldGroup - Groups multiple Field components vertically
 * Use to organize related fields in a section
 *
 * ## Example:
 * ```tsx
 * <FieldGroup gap={4}>
 *   <Field label="Name">John Doe</Field>
 *   <Field label="Email">john@example.com</Field>
 * </FieldGroup>
 * ```
 */
export const FieldGroup = forwardRef<HTMLDivElement, FieldGroupProps>(
  ({ gap = 4, className, ...props }, ref) => (
    <Stack ref={ref} gap={gap} className={className} {...props} />
  ),
);
FieldGroup.displayName = 'FieldGroup';

