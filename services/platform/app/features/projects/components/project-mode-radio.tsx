'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { cn } from '@/lib/utils/cn';

// `'all'` is a legacy value still accepted by the backend for older project
// rows; the UI no longer offers it as a choice (single-list model). Read
// paths that need to display a stored `'all'` should map it to
// `'recommended'` before passing into this radio.
export type ProjectModeRadioValue = 'recommended' | 'restricted';

export interface ProjectModeRadioOption {
  value: ProjectModeRadioValue;
  label: string;
  description: string;
}

interface ProjectModeRadioProps {
  value: ProjectModeRadioValue;
  onChange: (next: ProjectModeRadioValue) => void;
  options: ProjectModeRadioOption[];
  disabled?: boolean;
  legend?: string;
}

/**
 * Mode picker for project Agents / Models. Card chrome matches the same
 * `border-primary bg-primary/5` selection language as human-input radio cards;
 * the indicator is the shared `RadioGroupItem` (accent-base), not a native
 * `<input type="radio">` that would paint the browser's blue control.
 */
export function ProjectModeRadio({
  value,
  onChange,
  options,
  disabled,
  legend,
}: ProjectModeRadioProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as ProjectModeRadioValue)}
      disabled={disabled}
      aria-label={legend}
      className="gap-2"
    >
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            className={cn(
              'border-border flex cursor-pointer items-start gap-3 rounded-md border p-3',
              checked && 'border-primary bg-primary/5',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <RadioGroupItem
              value={opt.value}
              disabled={disabled}
              className="mt-1"
              aria-label={opt.label}
            />
            <Stack gap={1}>
              <Text className="font-medium">{opt.label}</Text>
              <Text variant="caption">{opt.description}</Text>
            </Stack>
          </label>
        );
      })}
    </RadioGroup>
  );
}
