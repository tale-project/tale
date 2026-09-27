'use client';

import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import {
  DataTableFilters,
  type FilterConfig,
} from '@tale/ui/data-table/data-table-filters';
import { Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import {
  ERASURE_STATUSES,
  type ErasureStatus,
} from '@/backend/core/governance/erasure_constants';
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

  // Every column but the subject holds its widest value in every shipped
  // locale, and the subject takes the rest. The sizes sum to ~930px, so under
  // the `max-w-3xl` settings measure the table scrolls sideways.
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
        // The widest status, German "Fehlgeschlagen", with its icon; the
        // longer cooling-off label wraps inside its badge.
        size: 148,
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
        // The widest countdown, French "En retard de 12j", with its icon.
        size: 148,
      },
      {
        accessorKey: 'targetUserName',
        header: t('dataSubjectRequests.columns.target'),
        // The subject takes the slack; this floor fits the French header
        // "Personne concernée".
        size: 164,
        meta: { flex: true, skeleton: { type: 'two-line' } },
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
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
          </Stack>
        ),
      },
      {
        id: 'reasonCode',
        header: t('dataSubjectRequests.columns.reasonCode'),
        cell: ({ row }) =>
          row.original.reasonCode ? (
            <Text as="span" variant="muted" className="block text-xs" truncate>
              {t(
                `dataSubjectRequests.reasonCodes.${row.original.reasonCode}.label`,
              )}
            </Text>
          ) : (
            <Text as="span" variant="muted">
              —
            </Text>
          ),
        // The widest reason, Swiss German "Unrechtmässige Verarbeitung".
        size: 196,
      },
      {
        accessorKey: 'requestedByName',
        header: t('dataSubjectRequests.columns.requestedBy'),
        // `block`, so a name that is one unbreakable token (the requester's
        // id, once they have left) truncates instead of spilling over.
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
        header: t('dataSubjectRequests.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        // A short date such as "09/27/2026", under the German "Eingereicht".
        size: 108,
      },
    ],
    [t],
  );

  if (!canRead) {
    return <AccessDenied message={t('dataSubjectRequests.accessDenied')} />;
  }

  return (
    <>
      <SettingsSection
        title={t('dataSubjectRequests.title')}
        description={t('dataSubjectRequests.description')}
      >
        <DataTableFilters
          filters={filterConfigs}
          actions={
            <Button
              type="button"
              variant="primary"
              onClick={() => setFileOpen(true)}
            >
              {/* FileText conveys "file an erasure request" — a trash icon
                  mis-signaled delete-now for an action that only opens the
                  file-request dialog. */}
              <FileText className="mr-1.5 size-4" aria-hidden />
              {t('dataSubjectRequests.actions.fileRequest')}
            </Button>
          }
        />
        <DataTable<ErasureRow>
          columns={columns}
          data={results ?? []}
          // H9-1: only mark loading on the initial fetch — `Load more`
          // fetches keep the existing rows visible.
          isLoading={isInitialLoading}
          approxRowCount={results?.length}
          getRowId={(row) => row._id}
          onRowClick={(row) => {
            void navigate({
              to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
              params: {
                id: organizationId,
                requestId: row.original._id,
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
            entityLabel: {
              one: t('dataSubjectRequests.entityLabelOne'),
              other: t('dataSubjectRequests.entityLabel'),
            },
          }}
          emptyState={{
            icon: FileText,
            title: t('dataSubjectRequests.sections.requestsList.empty.title'),
            description: t(
              'dataSubjectRequests.sections.requestsList.empty.description',
            ),
          }}
          caption={t('dataSubjectRequests.sections.requestsList.title')}
        />
      </SettingsSection>

      <FileRequestDialog
        open={fileOpen}
        onOpenChange={setFileOpen}
        organizationId={organizationId}
      />
    </>
  );
}
