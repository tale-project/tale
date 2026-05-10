'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';

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
  const ability = useAbility();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<ErasureStatus[]>([]);
  const [fileOpen, setFileOpen] = useState(false);

  // H9-3: gate the query on ability so the Convex subscription does not
  // fire (and the server doesn't reject) for non-admin users — they hit
  // AccessDenied below regardless. The hook treats `undefined`
  // organizationId as `'skip'`.
  const canRead = ability.can('write', 'orgSettings');
  const { results, status, loadMore } = useListErasureRequests({
    organizationId: canRead ? organizationId : undefined,
    statuses: statusFilter,
  });
  // H9-1: derive load-states from `status` so DataTable doesn't replace
  // existing rows with skeleton placeholders every time the user clicks
  // "Load more" (matches release-history-section.tsx pattern).
  const isInitialLoading = status === 'LoadingFirstPage';
  const isLoadingMore = status === 'LoadingMore';

  const filterConfigs: FilterConfig[] = [
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
  ];

  const columns = useMemo<ColumnDef<ErasureRow>[]>(
    () => [
      {
        id: 'status',
        header: t('dataSubjectRequests.columns.status'),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            effectiveAt={row.original.effectiveAt}
          />
        ),
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

  if (!canRead) {
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
            {/* H9-5: FileText conveys "file an erasure request" — the
                previous Trash2 mis-signaled "delete-now" for an action
                that just opens the file-request dialog. */}
            <FileText className="mr-1.5 size-4" aria-hidden />
            {t('dataSubjectRequests.actions.fileRequest')}
          </Button>
        }
      >
        <DataTableFilters filters={filterConfigs} />
        <DataTable<ErasureRow>
          columns={columns}
          data={results ?? []}
          // H9-1: only mark loading on the initial fetch — `Load more`
          // fetches keep the existing rows visible.
          isLoading={isInitialLoading}
          approxRowCount={results?.length}
          getRowId={(row) => String(row._id)}
          onRowClick={(row) => {
            void navigate({
              to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
              params: {
                id: organizationId,
                requestId: String(row.original._id),
              },
            });
          }}
          // H9-2: use DataTable's built-in infiniteScroll (auto IntersectionObserver
          // + accessible loading/end-of-list affordances) instead of a hand-rolled
          // button outside the table border.
          infiniteScroll={{
            hasMore: status === 'CanLoadMore',
            onLoadMore: () => loadMore(25),
            isLoadingMore,
            isInitialLoading,
          }}
          emptyState={{
            title: t('dataSubjectRequests.sections.requestsList.empty.title'),
            description: t(
              'dataSubjectRequests.sections.requestsList.empty.description',
            ),
          }}
          caption={t('dataSubjectRequests.sections.requestsList.title')}
        />
      </PageSection>

      <FileRequestDialog
        open={fileOpen}
        onOpenChange={setFileOpen}
        organizationId={organizationId}
      />
    </>
  );
}
