'use client';

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { IconButton } from '@tale/ui/icon-button';
import { Row } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, Pencil, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useT } from '@/lib/i18n/client';

import { useLegalMatters } from '../hooks/queries';
import { CloseMatterDialog } from './close-matter-dialog';
import { UpsertMatterDialog } from './upsert-matter-dialog';

type MatterRow = NonNullable<
  ReturnType<typeof useLegalMatters>['data']
>[number];

interface MattersSectionProps {
  organizationId: string;
}

export function MattersSection({ organizationId }: MattersSectionProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>(
    'all',
  );
  const [editing, setEditing] = useState<MatterRow | null>(null);
  const [closing, setClosing] = useState<MatterRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const {
    data: matters,
    error,
    refetch,
    isFetching,
    errorUpdateCount,
  } = useLegalMatters(organizationId, {
    status: statusFilter,
  });

  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery<HTMLElement>({
      error,
      results: matters ?? [],
      retry: refetch,
    });

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('legalHold.filters.allStatuses') },
      { value: 'open', label: t('legalHold.filters.open') },
      { value: 'closed', label: t('legalHold.filters.closed') },
    ],
    [t],
  );

  const columns = useMemo<ColumnDef<MatterRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('legalHold.columns.name'),
        cell: ({ row }) => (
          <Text as="span" truncate title={row.original.name}>
            {row.original.name}
          </Text>
        ),
      },
      {
        accessorKey: 'caseNumber',
        header: t('legalHold.columns.caseNumber'),
        cell: ({ row }) => row.original.caseNumber ?? '—',
        size: 160,
      },
      {
        accessorKey: 'status',
        header: t('legalHold.columns.status'),
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'open' ? 'green' : 'outline'}>
            {t(`legalHold.filters.${row.original.status}`)}
          </Badge>
        ),
        meta: { skeleton: { type: 'badge' as const } },
        size: 110,
      },
      {
        accessorKey: 'linkedActiveHolds',
        header: t('legalHold.columns.linkedHolds'),
        cell: ({ row }) => row.original.linkedActiveHolds,
        size: 156,
      },
      {
        accessorKey: 'createdAt',
        header: t('legalHold.columns.createdAt'),
        cell: ({ row }) => <TableDateCell date={row.original.createdAt} />,
        size: 160,
      },
      {
        id: 'actions',
        header: t('legalHold.columns.actions'),
        meta: {
          isAction: true,
          align: 'right' as const,
          skeleton: { actionSize: 'sm', actionCount: 2 },
        },
        cell: ({ row }) => (
          <Row gap={1} align="stretch" justify="end">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={t('legalHold.actions.editMatter')}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
            />
            {row.original.status === 'open' && (
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                icon={Archive}
                aria-label={t('legalHold.actions.closeMatter')}
                onClick={(e) => {
                  e.stopPropagation();
                  setClosing(row.original);
                }}
              />
            )}
          </Row>
        ),
        size: 200,
      },
    ],
    [t],
  );

  const list = useListPage<MatterRow>({
    dataSource: { type: 'query', data: matters, error, retry: retryRead },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    // The server filters by status, so another status is another collection.
    windowKey: statusFilter,
    search: {
      fields: ['name', 'caseNumber'],
      placeholder: t('legalHold.sections.matters.searchPlaceholder'),
    },
    filters: {
      configs: [
        {
          key: 'status',
          title: t('legalHold.columns.status'),
          options: statusOptions.filter((o) => o.value !== 'all'),
          selectedValues: statusFilter === 'all' ? [] : [statusFilter],
          onChange: (values) =>
            setStatusFilter(
              values[0] === 'open' || values[0] === 'closed'
                ? values[0]
                : 'all',
            ),
        },
      ],
      onClear: () => setStatusFilter('all'),
    },
    getRowId: (row) => row._id,
    entityLabel: {
      one: t('legalHold.sections.matters.entityLabelOne'),
      other: t('legalHold.sections.matters.entityLabel'),
    },
  });

  return (
    <>
      <SettingsSection
        ref={regionRef}
        tabIndex={-1}
        title={t('legalHold.sections.matters.title')}
        description={t('legalHold.sections.matters.description')}
      >
        {failedWithRows && (
          <CatalogLoadError
            message={tCommon('errors.errorLoadingPage')}
            onRetry={retryRead}
            isRetrying={isFetching}
            failureKey={errorUpdateCount}
            onFocusLost={focusRegion}
          />
        )}
        <DataTable<MatterRow>
          columns={columns}
          onErrorFocusLost={focusRegion}
          addAction={{
            label: t('legalHold.actions.createMatter'),
            icon: Scale,
            onClick: () => setCreateOpen(true),
          }}
          emptyState={{
            icon: Archive,
            title: t('legalHold.sections.matters.empty.title'),
            description: t('legalHold.sections.matters.empty.description'),
          }}
          caption={t('legalHold.sections.matters.title')}
          {...list.tableProps}
        />
      </SettingsSection>

      <UpsertMatterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
      <UpsertMatterDialog
        key={editing?._id ?? 'edit-empty'}
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        organizationId={organizationId}
        matter={
          editing
            ? {
                _id: editing._id,
                name: editing.name,
                caseNumber: editing.caseNumber,
                description: editing.description,
              }
            : undefined
        }
      />
      <CloseMatterDialog
        open={closing !== null}
        onOpenChange={(next) => {
          if (!next) setClosing(null);
        }}
        matter={
          closing
            ? {
                _id: closing._id,
                name: closing.name,
                linkedActiveHolds: closing.linkedActiveHolds,
              }
            : null
        }
      />
    </>
  );
}
