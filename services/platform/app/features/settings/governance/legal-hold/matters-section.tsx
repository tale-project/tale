'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { DataTableFilters } from '@tale/ui/data-table/data-table-filters';
import { isFilterAffordanceDisabled } from '@tale/ui/filters/filter-panel';
import { IconButton } from '@tale/ui/icon-button';
import { Row } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, Pencil, Scale } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { readStateOf } from '@/app/lib/backend/read-state';
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
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>(
    'all',
  );
  const [editing, setEditing] = useState<MatterRow | null>(null);
  const [closing, setClosing] = useState<MatterRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const mattersQuery = useLegalMatters(organizationId, {
    status: statusFilter,
  });
  const { data: matters, isLoading, isError, refetch } = mattersQuery;
  // A failed read is named, never passed off as "No matters" (#3837): an
  // operator who believes the register is clear opens a duplicate matter.
  // The flags hold through a retry, which react-query starts from `pending`
  // for a read that never answered.
  const read = readStateOf(mattersQuery);
  const retry = useCallback(() => void refetch(), [refetch]);
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = useCallback(() => sectionRef.current?.focus(), []);

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

  return (
    <>
      <SettingsSection
        // The register's region: a notice that leaves while it holds the
        // focus hands it here, not to the page.
        ref={sectionRef}
        tabIndex={-1}
        className="outline-none"
        title={t('legalHold.sections.matters.title')}
        description={t('legalHold.sections.matters.description')}
      >
        <DataTableFilters
          filters={[
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
          ]}
          // This bar sits ABOVE its `DataTable` rather than inside it, so the
          // emptiness signal the table computes for itself never reaches it —
          // the filter has to be disabled from here or it opens over a set that
          // is guaranteed empty.
          disabled={isFilterAffordanceDisabled({
            isLoading,
            isError,
            itemCount: matters?.length ?? 0,
            hasActiveFilters: statusFilter !== 'all',
          })}
          actions={
            <Button
              type="button"
              variant="primary"
              onClick={() => setCreateOpen(true)}
            >
              <Scale className="mr-1.5 size-4" aria-hidden />
              {t('legalHold.actions.createMatter')}
            </Button>
          }
        />
        {(read.unavailable || read.stale) && (
          <CatalogLoadError
            // Each failure is announced again. Try again keeps its node, and
            // the focus on it, through the retry; once the matters answer,
            // the focus goes to the section.
            failureKey={read.failureCount}
            onFocusLost={focusSection}
            message={t(
              read.unavailable
                ? 'legalHold.sections.matters.loadFailed'
                : 'legalHold.sections.matters.refreshFailed',
            )}
            onRetry={retry}
            isRetrying={read.retrying}
          />
        )}
        {/* Nothing about the register is known until the read answers, so no
            table stands under the alert — its empty state would say there
            are no matters. A failed refresh keeps the rows it last read. */}
        {!read.unavailable && (
          <DataTable<MatterRow>
            columns={columns}
            data={matters ?? []}
            isLoading={isLoading}
            approxRowCount={matters?.length}
            getRowId={(row) => row._id}
            emptyState={{
              icon: Archive,
              title: t('legalHold.sections.matters.empty.title'),
              description: t('legalHold.sections.matters.empty.description'),
            }}
            caption={t('legalHold.sections.matters.title')}
          />
        )}
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
