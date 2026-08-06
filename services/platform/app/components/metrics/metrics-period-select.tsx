'use client';

import { useMemo } from 'react';

import {
  DataTableFilters,
  type FilterConfig,
} from '@/app/components/ui/data-table/data-table-filters';
import { useT } from '@/lib/i18n/client';

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
  /**
   * The page's resting window (what `parseMetricsPeriodDays` falls back to).
   * Showing it is not an active filter, so the button carries no dot until
   * another window is picked.
   */
  defaultValue?: MetricsPeriodOption;
  /**
   * A page's own OPTIONAL narrowing dimensions (an agent facet, a granularity
   * switch), rendered as sections of the SAME filter button ahead of the
   * period — a metrics toolbar carries one filter control, never a row of
   * selects.
   *
   * A required SCOPE — the subject the whole page reports on, without which it
   * renders an empty state — does not belong here: behind a button labelled
   * "Filter" the choice reads as optional, and the live scope can't be read
   * without reopening the panel. Give it `MetricsScopeSelect` beside this
   * control instead.
   */
  extraFilters?: FilterConfig[];
}

/**
 * The ONE period control for metrics surfaces — the same filter button every
 * table toolbar uses. Owns the shared `metrics.period.*` labels so every page
 * offers identically worded windows; pages own the value parsing
 * (`parseMetricsPeriodDays` for the 7/30/90 set). Single-select with a
 * mandatory window: clearing falls back to the page's default, because a
 * metrics view always needs a period.
 */
export function MetricsPeriodSelect({
  value,
  onValueChange,
  periods = DEFAULT_PERIODS,
  defaultValue = '30',
  extraFilters,
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
    <DataTableFilters
      // Metrics toolbars sit at the right edge of a full-width header, so the
      // panel pins to the button's bottom-right corner instead of spilling
      // toward (or past) the viewport edge.
      align="end"
      filters={[
        ...(extraFilters ?? []),
        {
          key: 'period',
          title: t('period.label'),
          options,
          selectedValues: [value],
          defaultValues: [defaultValue],
          onChange: (values) => onValueChange(values[0] ?? defaultValue),
        },
      ]}
    />
  );
}
