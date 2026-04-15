'use client';

import { Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface BlockCountersTableProps {
  organizationId: string;
}

export function BlockCountersTable({
  organizationId,
}: BlockCountersTableProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();
  const { data, isLoading } = useConvexQuery(
    api.login_attempts.queries.listBlockCounters,
    { organizationId, limit: 200 },
  );

  if (isLoading) return null;

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <Text variant="muted" className="text-sm">
        {t('logs.blockCounters.empty')}
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      <Text variant="muted" className="text-xs">
        {t('logs.blockCounters.description')}
      </Text>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                {t('logs.blockCounters.columns.window')}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t('logs.blockCounters.columns.email')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('logs.blockCounters.columns.lockout')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t('logs.blockCounters.columns.ipLimit')}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {t('logs.blockCounters.columns.lastIp')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr key={row._id} className="hover:bg-muted/30">
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {formatDate(new Date(row.windowStart), 'medium')}
                </td>
                <td className="px-3 py-2">{row.email}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.lockoutCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.ipLimitCount}
                </td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {row.lastIp ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Stack>
  );
}
