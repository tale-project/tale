'use client';

import { Badge } from '@tale/ui/badge';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Select } from '@/app/components/ui/forms/select';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
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

  const columns = useMemo<ColumnDef<HistoryRow>[]>(
    () => [
      {
        accessorKey: 'targetType',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <div className="flex flex-col">
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
          </div>
        ),
        size: 200,
      },
      {
        accessorKey: 'requestedByName',
        header: t('legalHold.columns.requestedBy'),
        cell: ({ row }) => row.original.requestedByName,
        size: 140,
      },
      {
        accessorKey: 'requestedAt',
        header: t('legalHold.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        size: 160,
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
        size: 110,
      },
      {
        accessorKey: 'approvedByName',
        header: t('legalHold.columns.approvedBy'),
        cell: ({ row }) =>
          row.original.approvedByName ?? row.original.rejectedByName ?? '—',
        size: 140,
      },
      {
        accessorKey: 'reason',
        header: t('legalHold.columns.reason'),
        cell: ({ row }) => (
          <Text as="span" truncate title={row.original.reason}>
            {row.original.reason}
          </Text>
        ),
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
        size: 200,
      },
    ],
    [t],
  );

  const isInitialLoading = result.status === 'LoadingFirstPage';
  const hasMore =
    result.status === 'CanLoadMore' || result.status === 'LoadingMore';
  const isLoadingMore = result.status === 'LoadingMore';

  return (
    <PageSection
      title={t('legalHold.sections.history.title')}
      description={t('legalHold.sections.history.description')}
    >
      <div className="flex items-center gap-2">
        <Select
          id="release-history-status-filter"
          size="sm"
          value={status}
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select onValueChange yields string; options are constrained to ReleaseStatus
          onValueChange={(v) => setStatus(v as ReleaseStatus)}
          options={statusOptions}
          aria-label={t('legalHold.columns.status')}
        />
      </div>
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
        }}
        emptyState={{
          title: t('legalHold.sections.history.empty.title'),
          description: t('legalHold.sections.history.empty.description'),
        }}
        caption={t('legalHold.sections.history.title')}
      />
    </PageSection>
  );
}
