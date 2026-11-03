import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { FIELD_ROW_CONTROL, FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import { useId, type ReactNode } from 'react';

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** The control: it sits in the settings control column. */
  children: ReactNode;
}

/**
 * A label with its help beside a control that is not a text field (a theme
 * picker, a language menu), on the row layout every field of a settings page
 * takes: stacked on a narrow surface, label left and control right from 36rem,
 * the control in the one column all the controls of the page line up in.
 * Mirrors `SettingsRow` and `SettingsFieldRow` of the platform
 * (`services/platform/app/features/settings/components/{settings-row,
 * settings-field-list}.tsx`).
 *
 * One thing it does that the platform's does not: it names its control as a
 * group. A wrapper `<div>` names nothing for assistive technology, and a plain
 * label names nothing for a control that has no `for` (a segmented control, a
 * menu button).
 */
export function SettingsRow({
  label,
  description,
  children,
}: SettingsRowProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description === undefined ? undefined : `${id}-desc`;

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      className={cn('flex flex-col gap-1.5', FIELD_ROW_FRAME)}
    >
      {/* The label column of a row, as the fields of the page have it (the
          `FieldShell` of `Input`): it yields width before the control does, and
          sits 8px down so that its first line is centred on a 36px control (a
          segmented control, a menu button), not at the control's top edge. */}
      <div className="flex min-w-0 flex-col gap-1 @xl/field-layout:max-w-xs @xl/field-layout:pt-2">
        <span
          id={labelId}
          className="text-foreground text-sm leading-none font-medium"
        >
          {label}
        </span>
        {description !== undefined && (
          <Description id={descriptionId}>{description}</Description>
        )}
      </div>
      <div className={cn('w-full', FIELD_ROW_CONTROL)}>{children}</div>
    </div>
  );
}
