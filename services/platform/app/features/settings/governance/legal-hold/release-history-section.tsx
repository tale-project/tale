'use client';

import { Badge } from '@tale/ui/badge';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';

import { useLegalHoldReleaseRequestsPaginated } from '../hooks/queries';

type ReleaseStatus = 'effected' | 'rejected' | 'approved' | 'pending';

type HistoryRow = {
  _id: string;
  organizationId: string;
  holdId: string;
  targetType?: 'thread' | 'document' | 'execution' | 'userMembership' | 'org';
  targetId?: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  reason: string;
  status: ReleaseStatus;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: number;
  effectiveAt?: number;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: number;
  rejectReason?: string;
};

interface ReleaseHistorySectionProps {
  organizationId: string;
}

export function ReleaseHistorySection({
  organizationId,
}: ReleaseHistorySectionProps) {
  const { t } = useT('governance');
  const [status, setStatus] = useState<ReleaseStatus>('effected');

  const result = useLegalHoldReleaseRequestsPaginated({
    organizationId,
    status,
    initialNumItems: 25,
  });

  const statusOptions = useMemo(
    () => [
      { value: 'effected', label: t('legalHold.filters.effected') },
      { value: 'rejected', label: t('legalHold.filters.rejected') },
      { value: 'approved', label: t('legalHold.filters.approved') },
      { value: 'pending', label: t('legalHold.filters.pending') },
    ],
    [t],
  );

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Keep the total ≤ 940px so the table fits the settings content column on
  // common laptop widths instead of clipping behind a horizontal scroll.
  const columns = useMemo<ColumnDef<HistoryRow>[]>(
    () => [
      {
        accessorKey: 'targetType',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <Stack gap={0}>
            {row.original.targetType && (
              <Badge variant="outline" className="self-start">
                {t(`legalHold.targetTypes.${row.original.targetType}`)}
              </Badge>
            )}
            <Text
              as="span"
              variant="muted"
              truncate
              className="font-mono text-xs"
              title={row.original.targetId ?? row.original.holdId}
            >
              {row.original.targetId ?? row.original.holdId}
            </Text>
          </Stack>
        ),
        meta: { skeleton: { type: 'two-line' as const } },
        size: 180,
      },
      {
        accessorKey: 'requestedByName',
        header: t('legalHold.columns.requestedBy'),
        cell: ({ row }) => row.original.requestedByName,
        size: 130,
      },
      {
        accessorKey: 'requestedAt',
        header: t('legalHold.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        size: 120,
      },
      {
        accessorKey: 'status',
        header: t('legalHold.columns.status'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'effected'
                ? 'green'
                : row.original.status === 'rejected'
                  ? 'destructive'
                  : 'outline'
            }
          >
            {t(`legalHold.filters.${row.original.status}`)}
          </Badge>
        ),
        meta: { skeleton: { type: 'badge' as const } },
        size: 110,
      },
      {
        accessorKey: 'approvedByName',
        header: t('legalHold.columns.approvedBy'),
        cell: ({ row }) =>
          row.original.approvedByName ?? row.original.rejectedByName ?? '—',
        size: 130,
      },
      {
        accessorKey: 'reason',
        header: t('legalHold.columns.reason'),
        cell: ({ row }) => (
          <Text as="span" truncate title={row.original.reason}>
            {row.original.reason}
          </Text>
        ),
        size: 130,
      },
      {
        accessorKey: 'rejectReason',
        header: t('legalHold.columns.rejectReason'),
        cell: ({ row }) =>
          row.original.rejectReason ? (
            <Text as="span" truncate title={row.original.rejectReason}>
              {row.original.rejectReason}
            </Text>
          ) : (
            '—'
          ),
        size: 140,
      },
    ],
    [t],
  );

  const isInitialLoading = result.status === 'LoadingFirstPage';
  const hasMore =
    result.status === 'CanLoadMore' || result.status === 'LoadingMore';
  const isLoadingMore = result.status === 'LoadingMore';

  return (
    <SettingsSection
      title={t('legalHold.sections.history.title')}
      description={t('legalHold.sections.history.description')}
    >
      <Row gap={2}>
        <DataTableFilters
          filters={[
            {
              key: 'status',
              title: t('legalHold.columns.status'),
              options: statusOptions,
              selectedValues: [status],
              // Single-select with a mandatory value — the history query
              // always filters by one status, so clearing falls back to the
              // default bucket instead of an unfiltered view.
              onChange: (values) =>
                setStatus(
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options are constrained to ReleaseStatus
                  (values[0] as ReleaseStatus | undefined) ?? 'effected',
                ),
            },
          ]}
        />
      </Row>
      <DataTable<HistoryRow>
        columns={columns}
        data={result.results as HistoryRow[]}
        isLoading={isInitialLoading}
        approxRowCount={result.results.length}
        getRowId={(row) => row._id}
        infiniteScroll={{
          hasMore,
          onLoadMore: () => result.loadMore(25),
          isLoadingMore,
          isInitialLoading,
          entityLabel: {
            one: t('legalHold.sections.history.entityLabelOne'),
            other: t('legalHold.sections.history.entityLabel'),
          },
        }}
        emptyState={{
          icon: History,
          title: t('legalHold.sections.history.empty.title'),
          description: t('legalHold.sections.history.empty.description'),
        }}
        caption={t('legalHold.sections.history.title')}
      />
    </SettingsSection>
  );
}
