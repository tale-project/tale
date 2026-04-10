'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Select } from '@/app/components/ui/forms/select';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { formatCurrency, formatNumber } from '@/lib/utils/format/number';

interface UsageDashboardProps {
  organizationId: string;
}

type UsageEntry = {
  userId: string;
  teamId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
  requestCount: number;
};

function buildPeriodOptions(): { value: string; label: string }[] {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
    options.push({ value: key, label });
  }
  return options;
}

function getCurrentPeriodKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text className="text-muted-foreground text-xs">{label}</Text>
      <Text className="font-mono text-lg font-semibold">{value}</Text>
    </div>
  );
}

export function UsageDashboard({ organizationId }: UsageDashboardProps) {
  const [periodKey, setPeriodKey] = useState(getCurrentPeriodKey);
  const periodOptions = useMemo(() => buildPeriodOptions(), []);

  const { data, isLoading } = useConvexQuery(
    api.governance.queries.getUsageSummary,
    { organizationId, periodKey },
  );

  const entries = data?.entries ?? [];
  const totals = data?.totals;

  const columns = useMemo<ColumnDef<UsageEntry>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        cell: ({ row }) => (
          <Text as="span" variant="label" className="font-mono text-xs">
            {row.original.userId}
          </Text>
        ),
        size: 220,
      },
      {
        id: 'team',
        header: 'Team',
        cell: ({ row }) => (
          <Text as="span" variant="caption">
            {row.original.teamId ?? '\u2014'}
          </Text>
        ),
        size: 160,
      },
      {
        id: 'inputTokens',
        header: () => <div className="text-right">Input Tokens</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.inputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'outputTokens',
        header: () => <div className="text-right">Output Tokens</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.outputTokens)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'cost',
        header: () => <div className="text-right">Cost</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatCurrency(row.original.costEstimate / 100, 'USD')}
          </div>
        ),
        meta: { align: 'right' as const },
      },
      {
        id: 'requests',
        header: () => <div className="text-right">Requests</div>,
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs">
            {formatNumber(row.original.requestCount)}
          </div>
        ),
        meta: { align: 'right' as const },
      },
    ],
    [],
  );

  return (
    <Stack gap={4}>
      <div className="flex items-center justify-between">
        <Text as="h3" variant="label">
          Usage
        </Text>
        <div className="w-56">
          <Select
            options={periodOptions}
            value={periodKey}
            onValueChange={setPeriodKey}
            size="sm"
          />
        </div>
      </div>

      {totals && entries.length > 0 && (
        <HStack gap={8} className="border-border rounded-lg border px-5 py-3">
          <StatCard
            label="Total Tokens"
            value={formatNumber(totals.totalTokens)}
          />
          <StatCard
            label="Total Cost"
            value={formatCurrency(totals.costEstimate / 100, 'USD')}
          />
          <StatCard
            label="Total Requests"
            value={formatNumber(totals.requestCount)}
          />
          <StatCard label="Active Users" value={String(entries.length)} />
        </HStack>
      )}

      <DataTable
        columns={columns}
        data={entries}
        getRowId={(row) => `${row.userId}-${row.teamId ?? ''}`}
        isLoading={isLoading}
        approxRowCount={isLoading ? 3 : entries.length}
        emptyState={{
          icon: BarChart3,
          title: 'No usage data',
          description: 'No usage has been recorded for this period.',
        }}
      />
    </Stack>
  );
}
