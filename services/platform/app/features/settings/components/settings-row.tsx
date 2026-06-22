'use client';

import { Description } from '@tale/ui/description';
import { Stack } from '@tale/ui/layout';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface SettingsRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  label: ReactNode;
  description?: ReactNode;
  /** Right-side control (switch, button, copy field, link). */
  children: ReactNode;
}

/**
 * Horizontal label-control row used for inline settings: toggles, dialog
 * triggers, read-only values with copy buttons, etc. Stacks vertically on
 * narrow viewports so the right-side control wraps cleanly.
 */
export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(
  ({ label, description, children, className, ...props }, ref) => {
    const id = useId();
    const labelId = `${id}-label`;
    const descId = description ? `${id}-desc` : undefined;

    return (
      <div
        ref={ref}
        aria-labelledby={labelId}
        aria-describedby={descId}
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
          className,
        )}
        {...props}
      >
        <Stack gap={1} className="min-w-0">
          <span
            id={labelId}
            className="text-foreground text-sm leading-none font-medium"
          >
            {label}
          </span>
          {description && <Description id={descId}>{description}</Description>}
        </Stack>
        <div className="shrink-0">{children}</div>
      </div>
    );
  },
);
SettingsRow.displayName = 'SettingsRow';
