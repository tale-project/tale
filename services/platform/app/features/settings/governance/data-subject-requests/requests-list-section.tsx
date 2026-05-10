'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import {
  DataTableFilters,
  type FilterConfig,
} from '@/app/components/ui/data-table/data-table-filters';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import {
  ERASURE_STATUSES,
  type ErasureStatus,
} from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';

import { FileRequestDialog } from './file-request-dialog';
import { useListErasureRequests } from './hooks/queries';
import { SlaCountdownBadge } from './sla-countdown-badge';
import { StatusBadge } from './status-badge';

interface RequestsListSectionProps {
  organizationId: string;
}

type ErasureRow = NonNullable<
  ReturnType<typeof useListErasureRequests>['results']
>[number];

export function RequestsListSection({
  organizationId,
}: RequestsListSectionProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<ErasureStatus[]>([]);
  const [fileOpen, setFileOpen] = useState(false);

  const { results, status, loadMore, isLoading } = useListErasureRequests({
    organizationId,
    statuses: statusFilter,
  });

  const filterConfigs: FilterConfig[] = useMemo(
    () => [
      {
        key: 'status',
        title: t('dataSubjectRequests.filters.statusTitle'),
        multiSelect: true,
        columns: 2,
        options: ERASURE_STATUSES.map((s) => ({
          value: s,
          label: t(`dataSubjectRequests.status.${s}`),
        })),
        selectedValues: statusFilter,
        onChange: (values: string[]) => {
          const next: ErasureStatus[] = [];
          for (const value of values) {
            for (const s of ERASURE_STATUSES) {
              if (s === value) {
                next.push(s);
                break;
              }
            }
          }
          setStatusFilter(next);
        },
      },
    ],
    [t, statusFilter],
  );

  const columns = useMemo<ColumnDef<ErasureRow>[]>(
    () => [
      {
        id: 'status',
        header: t('dataSubjectRequests.columns.status'),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        size: 110,
      },
      {
        id: 'sla',
        header: t('dataSubjectRequests.columns.sla'),
        cell: ({ row }) => (
          <SlaCountdownBadge
            slaDeadlineAt={row.original.slaDeadlineAt}
            extensionDeadlineAt={row.original.extensionDeadlineAt}
            status={row.original.status}
          />
        ),
        size: 130,
      },
      {
        accessorKey: 'targetUserName',
        header: t('dataSubjectRequests.columns.target'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Text as="span" truncate title={row.original.targetUserName}>
              {row.original.targetUserName}
            </Text>
            {row.original.targetUserName !== row.original.targetUserId && (
              <Text
                as="span"
                variant="muted"
                truncate
                className="font-mono text-xs"
                title={row.original.targetUserId}
              >
                {row.original.targetUserId}
              </Text>
            )}
          </div>
        ),
        size: 220,
      },
      {
        id: 'reasonCode',
        header: t('dataSubjectRequests.columns.reasonCode'),
        cell: ({ row }) =>
          row.original.reasonCode ? (
            <Text as="span" variant="muted" className="text-xs" truncate>
              {t(
                `dataSubjectRequests.reasonCodes.${row.original.reasonCode}.label`,
              )}
            </Text>
          ) : (
            <Text as="span" variant="muted">
              —
            </Text>
          ),
        size: 180,
      },
      {
        accessorKey: 'requestedByName',
        header: t('dataSubjectRequests.columns.requestedBy'),
        cell: ({ row }) => (
          <Text as="span" truncate>
            {row.original.requestedByName}
          </Text>
        ),
        size: 160,
      },
      {
        accessorKey: 'requestedAt',
        header: t('dataSubjectRequests.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        size: 150,
      },
    ],
    [t],
  );

  const handleRowClick = useCallback(
    (row: { original: ErasureRow }) => {
      void navigate({
        to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
        params: { id: organizationId, requestId: String(row.original._id) },
      });
    },
    [navigate, organizationId],
  );

  const hasMore = status === 'CanLoadMore';

  if (ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={t('dataSubjectRequests.accessDenied')} />;
  }

  return (
    <>
      <PageSection
        title={t('dataSubjectRequests.title')}
        description={t('dataSubjectRequests.description')}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setFileOpen(true)}
          >
            <Trash2 className="mr-1.5 size-4" aria-hidden />
            {t('dataSubjectRequests.actions.fileRequest')}
          </Button>
        }
      >
        <DataTableFilters filters={filterConfigs} />
        <DataTable<ErasureRow>
          columns={columns}
          data={results ?? []}
          isLoading={isLoading}
          approxRowCount={results?.length}
          getRowId={(row) => String(row._id)}
          onRowClick={handleRowClick}
          emptyState={{
            title: t('dataSubjectRequests.sections.requestsList.empty.title'),
            description: t(
              'dataSubjectRequests.sections.requestsList.empty.description',
            ),
          }}
          caption={t('dataSubjectRequests.sections.requestsList.title')}
        />
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={isLoading}
              onClick={() => loadMore(25)}
            >
              {isLoading
                ? tCommon('actions.loading')
                : t('dataSubjectRequests.actions.loadMore')}
            </Button>
          </div>
        )}
      </PageSection>

      <FileRequestDialog
        open={fileOpen}
        onOpenChange={setFileOpen}
        organizationId={organizationId}
      />
    </>
  );
}
