'use client';

import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

interface SettingsRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  label: ReactNode;
  description?: ReactNode;
  /** Append a red required asterisk to the label (mirrors `Label`'s required). */
  required?: boolean;
  /**
   * `'row'` (default) — label left / control right once the surface has room
   * for both (a `data-field-layout="row"` container of 36rem — see
   * `FieldShell`), as settings pages use. `'stack'` — always label above
   * control, for narrow columns and dialogs where a side-by-side label column
   * would squeeze helper text.
   */
  layout?: 'row' | 'stack';
  /** Right-side control (switch, button, copy field, link). */
  children: ReactNode;
}

/**
 * Label-control row used for inline settings: toggles, dialog triggers,
 * read-only values with copy buttons, etc. Default layout is horizontal while
 * the enclosing settings surface is wide enough for two columns — the same
 * turn `FieldShell` takes, measured on the surface, never the viewport, so a
 * settings column squeezed beside the rail and the settings panel stacks
 * instead of wrapping its label a word per line. Pass `layout="stack"` for
 * label-above-control everywhere (dialogs, narrow panes).
 */
export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(
  (
    { label, description, layout = 'row', children, className, ...props },
    ref,
  ) => {
    const id = useId();
    const labelId = `${id}-label`;
    const descId = description ? `${id}-desc` : undefined;
    const stacked = layout === 'stack';

    return (
      <div
        ref={ref}
        aria-labelledby={labelId}
        aria-describedby={descId}
        className={cn(
          'flex flex-col gap-1.5',
          !stacked && FIELD_ROW_FRAME,
          className,
        )}
        {...props}
      >
        {/* Cap the text column at a readable line length (matching
            `SettingsSection`'s header and `SettingsToggleRow`) so a long
            description doesn't stretch to the full content width when the
            right-side control is narrow. Stacked layout already gives the
            label the full row width, so the cap is only for row mode. */}
        <div
          className={cn('flex min-w-0 flex-col gap-1', !stacked && 'max-w-2xl')}
        >
          <span
            id={labelId}
            className="text-foreground text-sm leading-none font-medium"
          >
            {label}
          </span>
          {description && <Description id={descId}>{description}</Description>}
        </div>
        <div className={cn(!stacked && 'shrink-0')}>{children}</div>
      </div>
    );
  },
);
SettingsRow.displayName = 'SettingsRow';
