'use client';

import { Description } from '@tale/ui/description';
import { forwardRef, useId, type HTMLAttributes, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface SettingsRowProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children'
> {
  label: ReactNode;
  description?: ReactNode;
  /** Append a red required asterisk to the label (mirrors `Label`'s required). */
  required?: boolean;
  /**
   * `'row'` (default) — label left / control right from `sm` up, as settings
   * pages use. `'stack'` — always label above control, for narrow columns and
   * dialogs where a side-by-side label column would squeeze helper text.
   */
  layout?: 'row' | 'stack';
  /** Right-side control (switch, button, copy field, link). */
  children: ReactNode;
}

/**
 * Label-control row used for inline settings: toggles, dialog triggers,
 * read-only values with copy buttons, etc. Default layout is horizontal from
 * `sm` up; pass `layout="stack"` for label-above-control (dialogs, narrow panes).
 */
export const SettingsRow = forwardRef<HTMLDivElement, SettingsRowProps>(
  (
    {
      label,
      description,
      required,
      layout = 'row',
      children,
      className,
      ...props
    },
    ref,
  ) => {
    const { t } = useT('common');
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
          !stacked && 'sm:flex-row sm:items-start sm:justify-between sm:gap-6',
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
            {required && (
              <span
                className="ml-1 text-red-600"
                aria-label={t('aria.required')}
              >
                *
              </span>
            )}
          </span>
          {description && <Description id={descId}>{description}</Description>}
        </div>
        <div className={cn(!stacked && 'shrink-0')}>{children}</div>
      </div>
    );
  },
);
SettingsRow.displayName = 'SettingsRow';
