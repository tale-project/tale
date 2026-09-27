'use client';

import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DataTableFilters } from '@tale/ui/data-table/data-table-filters';
import { Row, Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';

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

  // Column sizes double as the table's min-width floor (DataTable sums them):
  // ~990px, just under the settings content column of a 1366px laptop. Target
  // and reason split what the fixed columns leave.
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
        meta: { flex: true, skeleton: { type: 'badge-text' } },
        // A flex column; this is its floor, with room for the widest type
        // badge, "Organization".
        size: 144,
      },
      {
        accessorKey: 'requestedByName',
        header: t('legalHold.columns.requestedBy'),
        // `block truncate`: a requester who has left shows as their id, one
        // unbreakable token that would otherwise run into the next column.
        cell: ({ row }) => (
          <Text
            as="span"
            truncate
            className="block"
            title={row.original.requestedByName}
          >
            {row.original.requestedByName}
          </Text>
        ),
        // A name such as "Alexandra Schneider"; a longer one truncates.
        size: 168,
      },
      {
        accessorKey: 'requestedAt',
        header: t('legalHold.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        // A short date such as "09/27/2026".
        size: 108,
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
        // The widest status, German "Ausstehend", in its outlined badge.
        size: 116,
      },
      {
        accessorKey: 'approvedByName',
        header: t('legalHold.columns.approvedBy'),
        cell: ({ row }) => {
          const decidedBy =
            row.original.approvedByName ?? row.original.rejectedByName;
          return decidedBy ? (
            <Text as="span" truncate className="block" title={decidedBy}>
              {decidedBy}
            </Text>
          ) : (
            '—'
          );
        },
        // A name such as "Alexandra Schneider"; a longer one truncates.
        size: 168,
      },
      {
        accessorKey: 'reason',
        header: t('legalHold.columns.reason'),
        meta: { flex: true },
        cell: ({ row }) => (
          <Text
            as="span"
            truncate
            className="block"
            title={row.original.reason}
          >
            {row.original.reason}
          </Text>
        ),
        // A flex column; this is its floor.
        size: 144,
      },
      {
        accessorKey: 'rejectReason',
        header: t('legalHold.columns.rejectReason'),
        cell: ({ row }) =>
          row.original.rejectReason ? (
            <Text
              as="span"
              truncate
              className="block"
              title={row.original.rejectReason}
            >
              {row.original.rejectReason}
            </Text>
          ) : (
            '—'
          ),
        // The German header "Ablehnungsgrund"; a longer reason truncates.
        size: 144,
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
              defaultValues: ['effected'],
              // Switching bucket REVEALS rows the default one hides, so the
              // filter stays usable on an empty "effected" history — disabling
              // it there would strand the reader in the one empty bucket.
              widensResultSet: true,
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
        data={result.results}
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
