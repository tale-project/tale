'use client';

import { ReactNode, useId, useCallback } from 'react';

import { cn } from '@/lib/utils/cn';

import { Checkbox } from './checkbox';
import { Description } from './description';
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
    <div
      role="group"
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descriptionId : undefined}
      className={cn('flex flex-col gap-2', className)}
    >
      {label && (
        <Label id={labelId} required={required}>
          {label}
        </Label>
      )}
      {description && (
        <Description id={descriptionId} className="text-xs">
          {description}
        </Description>
      )}
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
  );
}
