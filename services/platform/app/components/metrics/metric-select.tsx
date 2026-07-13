'use client';

import { Select } from '@/app/components/ui/forms/select';
import { cn } from '@/lib/utils/cn';

interface MetricSelectOption {
  value: string;
  label: string;
}

interface MetricSelectProps {
  options: MetricSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  'aria-label': string;
  /** Shown while no option is selected (e.g. an entity picker). */
  placeholder?: string;
  /** Trigger width — defaults to `w-36`; widen for long labels. */
  widthClassName?: string;
}

/**
 * The standard toolbar dropdown for metrics pages — a small (`size="sm"`),
 * fixed-width `Select`. Centralizes the width + size so every period /
 * granularity / metric selector across the metrics surfaces matches.
 */
export function MetricSelect({
  options,
  value,
  onValueChange,
  'aria-label': ariaLabel,
  placeholder,
  widthClassName = 'w-36',
}: MetricSelectProps) {
  return (
    <div className={cn(widthClassName)}>
      <Select
        options={options}
        value={value}
        onValueChange={onValueChange}
        aria-label={ariaLabel}
        placeholder={placeholder}
      />
    </div>
  );
}
