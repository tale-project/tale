'use client';

import { Description } from '@tale/ui/description';
import type { ReactNode } from 'react';
import { useId, useCallback } from 'react';

import { cn } from '@/lib/utils/cn';

import { Checkbox } from './checkbox';
import { FieldShell } from './field-shell';
import { Label } from './label';

export interface CheckboxGroupOption {
  value: string;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
}

interface CheckboxGroupProps {
  label?: string;
  description?: ReactNode;
  options?: CheckboxGroupOption[];
  value?: string[];
  onValueChange?: (values: string[]) => void;
  disabled?: boolean;
  required?: boolean;
  children?: ReactNode;
  className?: string;
  /**
   * Number of columns for the options grid.
   * @default 2
   */
  columns?: 1 | 2;
}

export function CheckboxGroup({
  label,
  description,
  options,
  value,
  onValueChange,
  disabled,
  required,
  children,
  className,
  columns = 2,
}: CheckboxGroupProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  const handleToggle = useCallback(
    (optionValue: string, checked: boolean) => {
      if (!onValueChange) return;
      const next = checked
        ? [...(value ?? []), optionValue]
        : (value ?? []).filter((v) => v !== optionValue);
      onValueChange(next);
    },
    [value, onValueChange],
  );

  return (
    <FieldShell
      // A checkbox list reads as rows of its own, so it keeps the full width of
      // the control column even in label-left layouts.
      wideControl
      {...(label
        ? {
            label: (
              <Label id={labelId} required={required}>
                {label}
              </Label>
            ),
          }
        : {})}
      {...(description
        ? {
            description: (
              <Description id={descriptionId}>{description}</Description>
            ),
          }
        : {})}
      {...(className !== undefined ? { className } : {})}
    >
      {/* The group wraps the options only — the label and description moved
          into the field frame and still name it by id from the outside. */}
      <div
        role="group"
        aria-labelledby={label ? labelId : undefined}
        aria-describedby={description ? descriptionId : undefined}
      >
        {options ? (
          <div className={cn('grid gap-2', columns === 2 && 'grid-cols-2')}>
            {options.map((option) => (
              <Checkbox
                key={option.value}
                label={option.label}
                description={option.description}
                checked={value?.includes(option.value) ?? false}
                onCheckedChange={(checked) =>
                  handleToggle(option.value, checked === true)
                }
                disabled={disabled || option.disabled}
              />
            ))}
          </div>
        ) : (
          children
        )}
      </div>
    </FieldShell>
  );
}
