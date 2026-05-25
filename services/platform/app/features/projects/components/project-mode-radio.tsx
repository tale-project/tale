'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useId } from 'react';

import { cn } from '@/lib/utils/cn';

export type ProjectModeRadioValue = 'all' | 'recommended' | 'restricted';

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

export function ProjectModeRadio({
  value,
  onChange,
  options,
  disabled,
  legend,
}: ProjectModeRadioProps) {
  const name = useId();
  return (
    <Stack gap={2} role="radiogroup" aria-label={legend}>
      {options.map((opt) => {
        const checked = opt.value === value;
        const labelId = `${name}-${opt.value}-label`;
        return (
          // eslint-disable-next-line jsx-a11y/label-has-associated-control -- label wraps both the input and its descriptive text; the input has an accessible name via the wrapped <Text id={labelId}>.
          <label
            key={opt.value}
            className={cn(
              'border-border flex cursor-pointer items-start gap-3 rounded-md border p-3',
              checked && 'border-primary bg-primary/5',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
              aria-labelledby={labelId}
              className="mt-1"
            />
            <Stack gap={1}>
              <Text id={labelId} className="font-medium">
                {opt.label}
              </Text>
              <Text variant="caption">{opt.description}</Text>
            </Stack>
          </label>
        );
      })}
    </Stack>
  );
}
