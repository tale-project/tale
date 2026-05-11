'use client';

import { Clock } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

import { ChartCardHeader } from './chart-card-header';

interface StatusBreakdownProps {
  completed: number;
  failed: number;
  running: number;
}

export function StatusBreakdown({
  completed,
  failed,
  running,
}: StatusBreakdownProps) {
  const { t } = useT('automations');
  const total = completed + failed + running;

  const data = [
    {
      name: t('metrics.chart.completed'),
      value: completed,
      color: 'var(--color-chart-success, #10b981)',
    },
    {
      name: t('metrics.chart.failed'),
      value: failed,
      color: 'var(--color-chart-failure, #ef4444)',
    },
    {
      name: t('metrics.chart.running'),
      value: running,
      color: 'var(--color-chart-neutral, #9ca3af)',
    },
  ];
  const slices = data.filter((d) => d.value > 0);

  return (
    <div className="border-border bg-card flex h-full flex-col gap-4 rounded-lg border p-5">
      <ChartCardHeader
        title={t('metrics.chart.statusTitle')}
        tooltip={t('metrics.chart.statusTooltip')}
      />

      <div className="relative flex flex-1 items-center justify-center">
        {total === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center">
            <Clock className="h-8 w-8 opacity-60" aria-hidden />
            <Text className="text-sm font-medium">
              {t('metrics.chart.noData')}
            </Text>
            <Text className="text-muted-foreground text-xs">
              {t('metrics.chart.noDataDescription')}
            </Text>
          </div>
        ) : (
          <>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--popover)',
                    }}
                    formatter={(value) =>
                      typeof value === 'number' ? formatNumber(value) : ''
                    }
                  />
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={84}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {slices.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <Text className="text-2xl font-semibold tabular-nums">
                {formatNumber(total)}
              </Text>
              <Text className="text-muted-foreground text-xs">
                {t('metrics.chart.totalLabel')}
              </Text>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-3 w-3 rounded-[2px]"
              style={{ background: d.color }}
            />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="font-semibold tabular-nums">
              {formatNumber(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
