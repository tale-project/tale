import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { Switch } from '@tale/ui/switch';
import { forwardRef, useId, type ComponentRef, type ReactNode } from 'react';

interface SettingsToggleRowProps {
  /** Wired to the switch as its name. */
  label: ReactNode;
  /** Wired to the switch as its description. */
  description?: ReactNode;
  checked: boolean;
  /** Fired after the person flips the switch. */
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** While the change is on its way. */
  ariaBusy?: boolean;
  className?: string;
}

/**
 * A single-line settings toggle: label and description on the left, the switch
 * on the right, as the platform's (`SettingsToggleRow`,
 * `services/platform/app/features/settings/components/settings-toggle-row.tsx`).
 * It owns the wiring the switch needs, which is its own accessible name and
 * description, and the switch never drops below the text, so a long label
 * cannot push it out of the "controls live on the right" rhythm.
 *
 * Unlike the platform's it does not mask its description while the page loads:
 * this copy is static, and a mask over it shows a bar under a label that was
 * known all along. The page masks the switch (`Skeletonize`).
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
    const descriptionId = description ? `${id}-desc` : undefined;

    return (
      <div
        className={cn(
          'flex items-center justify-between gap-4 sm:gap-6',
          className,
        )}
      >
        <div className="flex max-w-2xl min-w-0 flex-col gap-1">
          {/* Wraps like every label: on a phone, or in German, it can outgrow
              the row, and an ellipsis would hide what the switch does. */}
          <span
            id={labelId}
            className="text-foreground text-sm leading-none font-medium"
          >
            {label}
          </span>
          {description && (
            <Description id={descriptionId}>{description}</Description>
          )}
        </div>
        <div className="shrink-0">
          <Switch
            ref={ref}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            aria-busy={ariaBusy}
          />
        </div>
      </div>
    );
  },
);
SettingsToggleRow.displayName = 'SettingsToggleRow';
