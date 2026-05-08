'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Select } from '@/app/components/ui/forms/select';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
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

  const { data: matters, isLoading } = useLegalMatters(organizationId, {
    status: statusFilter,
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
        size: 110,
      },
      {
        accessorKey: 'linkedActiveHolds',
        header: t('legalHold.columns.linkedHolds'),
        cell: ({ row }) => row.original.linkedActiveHolds,
        size: 130,
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
        meta: { isAction: true, align: 'right' as const },
        cell: ({ row }) => (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
            >
              {t('legalHold.actions.editMatter')}
            </Button>
            {row.original.status === 'open' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setClosing(row.original);
                }}
              >
                {t('legalHold.actions.closeMatter')}
              </Button>
            )}
          </div>
        ),
        size: 200,
      },
    ],
    [t],
  );

  return (
    <>
      <PageSection
        title={t('legalHold.sections.matters.title')}
        description={t('legalHold.sections.matters.description')}
        action={
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            {t('legalHold.actions.createMatter')}
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <Select
            id="matters-status-filter"
            size="sm"
            value={statusFilter}
            onValueChange={(v) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select onValueChange yields string; options are constrained
              setStatusFilter(v as 'open' | 'closed' | 'all')
            }
            options={statusOptions}
            aria-label={t('legalHold.filters.allStatuses')}
          />
        </div>
        <DataTable<MatterRow>
          columns={columns}
          data={matters ?? []}
          isLoading={isLoading}
          approxRowCount={matters?.length}
          getRowId={(row) => String(row._id)}
          emptyState={{
            title: t('legalHold.sections.matters.empty.title'),
            description: t('legalHold.sections.matters.empty.description'),
          }}
          caption={t('legalHold.sections.matters.title')}
        />
      </PageSection>

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
