'use client';

import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { MetricSelect } from './metric-select';

/** A selectable reporting window. Numeric strings are day counts. */
export type MetricsPeriodOption = '1' | '7' | '30' | '90' | 'all';

const DEFAULT_PERIODS: readonly MetricsPeriodOption[] = ['7', '30', '90'];

const PERIOD_LABEL_KEY: Record<MetricsPeriodOption, string> = {
  '1': 'period.last24Hours',
  '7': 'period.last7Days',
  '30': 'period.last30Days',
  '90': 'period.last90Days',
  all: 'period.allTime',
};

interface MetricsPeriodSelectProps {
  /** Current period as its option value (e.g. `'30'` or `String(periodDays)`). */
  value: string;
  onValueChange: (value: string) => void;
  /** Offered windows — defaults to the standard 7/30/90-day set. */
  periods?: readonly MetricsPeriodOption[];
}

/**
 * The ONE period dropdown for metrics surfaces. Owns the shared
 * `metrics.period.*` labels so every page offers identically worded windows;
 * pages own the value parsing (`parseMetricsPeriodDays` for the 7/30/90 set).
 */
export function MetricsPeriodSelect({
  value,
  onValueChange,
  periods = DEFAULT_PERIODS,
}: MetricsPeriodSelectProps) {
  const { t } = useT('metrics');

  const options = useMemo(
    () =>
      periods.map((period) => ({
        value: period,
        label: t(PERIOD_LABEL_KEY[period]),
      })),
    [periods, t],
  );

  return (
    <MetricSelect
      aria-label={t('period.label')}
      options={options}
      value={value}
      onValueChange={onValueChange}
    />
  );
}
