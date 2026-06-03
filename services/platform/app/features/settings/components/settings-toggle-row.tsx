'use client';

import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { forwardRef, useId, type ComponentRef, type ReactNode } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { cn } from '@/lib/utils/cn';

interface SettingsToggleRowProps {
  /** Row label (e.g. "Voice output"). Wired to the Switch via aria-labelledby. */
  label: ReactNode;
  /** Supporting copy below the label. Wired via aria-describedby. */
  description?: ReactNode;
  /** Controlled checked state. */
  checked: boolean;
  /** Fired after the user flips the switch. */
  onCheckedChange?: (checked: boolean) => void;
  /** Disables interaction. */
  disabled?: boolean;
  /** Optional aria-busy hint while the underlying state is loading. */
  ariaBusy?: boolean;
  /** Extra class on the outer row. */
  className?: string;
}

/**
 * Single-line settings toggle: label + description on the left, switch on
 * the right. Mirrors `SettingsRow`'s layout but owns the ARIA wiring for
 * the Switch — Radix's switch button needs its OWN accessible name (axe
 * `button-name` rule), so we generate a label `<span>` ID and pass it to
 * the Switch via `aria-labelledby` rather than relying on the row-level
 * association.
 *
 * Use this instead of pairing a `PageSection` with a bare `Switch`: the
 * bare-switch layout leaves the toggle anchored to the left under a
 * heading, breaking the "controls live on the right" visual rhythm shared
 * with the rest of settings.
 */
export const SettingsToggleRow = forwardRef<
  ComponentRef<typeof Switch>,
  SettingsToggleRowProps
>(
  (
    {
      label,
      description,
      checked,
      onCheckedChange,
      disabled,
      ariaBusy,
      className,
    },
    ref,
  ) => {
    const id = useId();
    const labelId = `${id}-label`;
    const descId = description ? `${id}-desc` : undefined;

    return (
      <div
        className={cn(
          'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
          className,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span
            id={labelId}
            className="text-foreground text-sm leading-none font-medium"
          >
            {label}
          </span>
          {description && (
            <Description id={descId} className="text-xs">
              {/* Masked while loading so a skeletonized settings page shows a
                  pulse here instead of raw (possibly stale) description text. */}
              <SkeletonBox fullWidth>{description}</SkeletonBox>
            </Description>
          )}
        </div>
        <div className="shrink-0">
          <Switch
            ref={ref}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={descId}
            aria-busy={ariaBusy}
          />
        </div>
      </div>
    );
  },
);
SettingsToggleRow.displayName = 'SettingsToggleRow';
