'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useT } from '@/lib/i18n/client';
import { formatCostCents, formatNumber } from '@/lib/utils/format/number';

export type UsageMetric = 'requests' | 'tokens' | 'cost';
export type UsageGranularity = 'daily' | 'weekly' | 'monthly';

export interface UsageSeriesPoint {
  periodKey: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costCents: number;
}

interface UsageTrendChartProps {
  series: UsageSeriesPoint[];
  metric: UsageMetric;
  granularity: UsageGranularity;
}

function shortLabel(periodKey: string, granularity: UsageGranularity): string {
  if (granularity === 'monthly') {
    return periodKey; // YYYY-MM
  }
  if (granularity === 'weekly') {
    return periodKey.slice(5); // "Www"
  }
  // daily YYYY-MM-DD → MM-DD
  return periodKey.slice(5);
}

export function UsageTrendChart({
  series,
  metric,
  granularity,
}: UsageTrendChartProps) {
  const { t } = useT('analytics');
  const loading = useSkeleton();

  const data = useMemo(
    () =>
      series.map((p) => ({
        ...p,
        label: shortLabel(p.periodKey, granularity),
      })),
    [series, granularity],
  );

  const ariaLabel = t('usage.chart.ariaLabel', {
    metric: t(`usage.metric.${metric}`),
  });

  const formatTooltipValue = (
    value: number | undefined,
    name: string | undefined,
  ): [string, string] => {
    const label = name ?? '';
    if (value === undefined) return ['', label];
    if (metric === 'cost') return [formatCostCents(value), label];
    return [formatNumber(value), label];
  };

  const formatYTick = (value: number): string => {
    if (metric === 'cost') return formatCostCents(value);
    if (value >= 1000)
      return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    return String(value);
  };

  return (
    <div
      className="border-border flex flex-col gap-4 rounded-lg border p-5"
      aria-label={ariaLabel}
    >
      <Text as="h3" className="text-foreground text-base font-semibold">
        {t(`usage.metric.${metric}`)}
      </Text>
      {/* Reserve the exact plot height (`h-72`) in both states. While the
          series loads, mask the plot so axes/bars don't flash in once data
          arrives — the bordered card + title stay put, so no shift. */}
      <div className="h-72 w-full">
        {loading ? (
          <SkeletonBox fullWidth>
            <div className="h-72 w-full" />
          </SkeletonBox>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-border"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                tickFormatter={formatYTick}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--popover)',
                }}
                labelFormatter={(_value, payload) => {
                  const first = payload?.[0];
                  if (
                    first &&
                    typeof first === 'object' &&
                    'payload' in first &&
                    first.payload &&
                    typeof first.payload === 'object' &&
                    'periodKey' in first.payload &&
                    typeof first.payload.periodKey === 'string'
                  ) {
                    return first.payload.periodKey;
                  }
                  return '';
                }}
                formatter={formatTooltipValue}
              />
              {metric === 'tokens' ? (
                <>
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="inputTokens"
                    stackId="tokens"
                    fill="var(--color-chart-primary, #3b82f6)"
                    name={t('usage.chart.inputTokens')}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="outputTokens"
                    stackId="tokens"
                    fill="var(--color-chart-success, #16a34a)"
                    name={t('usage.chart.outputTokens')}
                    radius={[4, 4, 0, 0]}
                  />
                </>
              ) : metric === 'requests' ? (
                <Bar
                  dataKey="requests"
                  fill="var(--color-chart-primary, #3b82f6)"
                  name={t('usage.metric.requests')}
                  radius={[4, 4, 0, 0]}
                />
              ) : (
                <Bar
                  dataKey="costCents"
                  fill="var(--color-chart-warning, #f59e0b)"
                  name={t('usage.metric.cost')}
                  radius={[4, 4, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
