'use client';

import { Stack } from '@tale/ui/layout';
import type { HTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** The label to display above the value */
  label: string;
  /** The value to display - can be text or custom ReactNode */
  children: ReactNode;
}

/**
 * LabeledValue - Displays a labeled value pair for read-only data display
 * Use for showing information in detail views, modals, and info panels
 *
 * ## Example:
 * ```tsx
 * <LabeledValue label="Email">john@example.com</LabeledValue>
 * <LabeledValue label="Status"><Badge>Active</Badge></LabeledValue>
 * ```
 */
export const LabeledValue = forwardRef<HTMLDivElement, FieldProps>(
  ({ label, children, className, ...props }, ref) => {
    const id = useId();
    const labelId = `${id}-label`;

    return (
      <div
        ref={ref}
        role="group"
        aria-labelledby={labelId}
        className={className}
        {...props}
      >
        <h4
          id={labelId}
          className="text-muted-foreground mb-1 text-sm font-medium"
        >
          {label}
        </h4>
        <div>{children}</div>
      </div>
    );
  },
);
LabeledValue.displayName = 'LabeledValue';

interface FieldGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Gap between fields (1-12, maps to Tailwind gap) */
  gap?: 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
}

/**
 * LabeledValueGroup - Groups multiple LabeledValue components vertically
 * Use to organize related fields in a section
 *
 * ## Example:
 * ```tsx
 * <LabeledValueGroup gap={4}>
 *   <LabeledValue label="Name">John Doe</LabeledValue>
 *   <LabeledValue label="Email">john@example.com</LabeledValue>
 * </LabeledValueGroup>
 * ```
 */
export const LabeledValueGroup = forwardRef<HTMLDivElement, FieldGroupProps>(
  ({ gap = 4, className, ...props }, ref) => (
    <Stack ref={ref} gap={gap} className={className} {...props} />
  ),
);
LabeledValueGroup.displayName = 'LabeledValueGroup';
