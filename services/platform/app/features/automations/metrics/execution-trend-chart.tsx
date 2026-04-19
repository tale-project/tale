'use client';

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

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

interface TrendPoint {
  dateKey: string;
  completed: number;
  failed: number;
}

interface ExecutionTrendChartProps {
  series: TrendPoint[];
}

function shortLabel(dateKey: string): string {
  const [, month, day] = dateKey.split('-');
  return `${month}-${day}`;
}

export function ExecutionTrendChart({ series }: ExecutionTrendChartProps) {
  const { t } = useT('automations');
  const data = series.map((p) => ({
    ...p,
    label: shortLabel(p.dateKey),
  }));

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border px-5 py-4">
      <Text variant="label" as="h3" className="text-sm">
        {t('metrics.chart.trendTitle')}
      </Text>
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
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
              labelFormatter={(value, payload) => {
                const first = payload?.[0];
                if (
                  first &&
                  typeof first === 'object' &&
                  'payload' in first &&
                  first.payload &&
                  typeof first.payload === 'object' &&
                  'dateKey' in first.payload &&
                  typeof first.payload.dateKey === 'string'
                ) {
                  return first.payload.dateKey;
                }
                return String(value);
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar
              dataKey="completed"
              stackId="runs"
              fill="var(--color-chart-success, #16a34a)"
              name={t('metrics.chart.completed')}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="failed"
              stackId="runs"
              fill="var(--color-chart-failure, #dc2626)"
              name={t('metrics.chart.failed')}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
