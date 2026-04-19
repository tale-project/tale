'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/utils/format/number';

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
      color: 'var(--color-chart-success, #16a34a)',
    },
    {
      name: t('metrics.chart.failed'),
      value: failed,
      color: 'var(--color-chart-failure, #dc2626)',
    },
    {
      name: t('metrics.chart.running'),
      value: running,
      color: 'var(--color-chart-neutral, #3b82f6)',
    },
  ].filter((d) => d.value > 0);

  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border px-5 py-4">
      <Text variant="label" as="h3" className="text-sm">
        {t('metrics.chart.statusTitle')}
      </Text>
      {total === 0 ? (
        <div className="text-muted-foreground flex h-60 items-center justify-center text-sm">
          {t('metrics.empty.noRuns')}
        </div>
      ) : (
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--popover)',
                }}
                formatter={(value: number) => formatNumber(value)}
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 rounded-full"
              style={{ background: d.color }}
            />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="font-mono font-semibold">
              {formatNumber(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
