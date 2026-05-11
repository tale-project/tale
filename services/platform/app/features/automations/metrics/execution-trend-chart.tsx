'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useT } from '@/lib/i18n/client';

import { ChartCardHeader } from './chart-card-header';

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

  const legend = [
    {
      name: t('metrics.chart.completed'),
      color: 'var(--color-chart-success, #10b981)',
    },
    {
      name: t('metrics.chart.failed'),
      color: 'var(--color-chart-failure, #ef4444)',
    },
  ];

  return (
    <div className="border-border bg-card flex h-full flex-col gap-4 rounded-lg border p-5">
      <ChartCardHeader
        title={t('metrics.chart.trendTitle')}
        tooltip={t('metrics.chart.trendTooltip')}
      />
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              className="text-muted-foreground"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={28}
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
            <Bar
              dataKey="completed"
              stackId="runs"
              fill="var(--color-chart-success, #10b981)"
              name={t('metrics.chart.completed')}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="failed"
              stackId="runs"
              fill="var(--color-chart-failure, #ef4444)"
              name={t('metrics.chart.failed')}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {legend.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-3 w-3 rounded-[2px]"
              style={{ background: d.color }}
            />
            <span className="text-muted-foreground">{d.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
