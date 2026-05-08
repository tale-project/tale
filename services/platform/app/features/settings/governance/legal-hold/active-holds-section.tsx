'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import type { ColumnDef } from '@tanstack/react-table';
import { Lock } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Select } from '@/app/components/ui/forms/select';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useLegalHolds } from '../hooks/queries';
import { BulkPlaceDialog } from './bulk-place-dialog';
import { PlaceHoldDialog } from './place-hold-dialog';
import { RequestReleaseDialog } from './request-release-dialog';

const TARGET_TYPES = [
  'thread',
  'document',
  'execution',
  'userMembership',
  'org',
] as const;
type TargetType = (typeof TARGET_TYPES)[number];

type LegalHoldRow = NonNullable<
  ReturnType<typeof useLegalHolds>['data']
>[number];

interface ActiveHoldsSectionProps {
  organizationId: string;
}

export function ActiveHoldsSection({
  organizationId,
}: ActiveHoldsSectionProps) {
  const { t } = useT('governance');
  const [targetTypeFilter, setTargetTypeFilter] = useState<TargetType | 'all'>(
    'all',
  );
  const [placeOpen, setPlaceOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [releaseHoldId, setReleaseHoldId] = useState<
    Id<'legalHolds'> | undefined
  >(undefined);

  const { data: rows, isLoading } = useLegalHolds(organizationId, {
    status: 'active',
    targetType: targetTypeFilter === 'all' ? undefined : targetTypeFilter,
  });

  const targetTypeOptions = useMemo(
    () => [
      { value: 'all', label: t('legalHold.filters.allTargets') },
      ...TARGET_TYPES.map((value) => ({
        value,
        label: t(`legalHold.targetTypes.${value}`),
      })),
    ],
    [t],
  );

  const columns = useMemo<ColumnDef<LegalHoldRow>[]>(
    () => [
      {
        accessorKey: 'targetType',
        header: t('legalHold.columns.type'),
        cell: ({ row }) => (
          <Badge variant="outline">
            {t(`legalHold.targetTypes.${row.original.targetType}`)}
          </Badge>
        ),
        size: 130,
      },
      {
        accessorKey: 'targetId',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            truncate
            className="font-mono text-xs"
            title={row.original.targetId}
          >
            {row.original.targetId}
          </Text>
        ),
        size: 220,
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
        accessorKey: 'matterName',
        header: t('legalHold.columns.matter'),
        cell: ({ row }) =>
          row.original.matterName ? (
            <Text as="span" variant="muted" truncate>
              {row.original.matterName}
            </Text>
          ) : (
            <Text as="span" variant="muted">
              —
            </Text>
          ),
        size: 180,
      },
      {
        accessorKey: 'placedByName',
        header: t('legalHold.columns.placedBy'),
        cell: ({ row }) => (
          <Text as="span" truncate>
            {row.original.placedByName}
          </Text>
        ),
        size: 160,
      },
      {
        accessorKey: 'placedAt',
        header: t('legalHold.columns.placedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.placedAt} />,
        size: 160,
      },
      {
        id: 'actions',
        header: t('legalHold.columns.actions'),
        meta: { isAction: true, align: 'right' as const },
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setReleaseHoldId(row.original._id);
              }}
            >
              {t('legalHold.actions.requestRelease')}
            </Button>
          </div>
        ),
        size: 140,
      },
    ],
    [t],
  );

  return (
    <>
      <PageSection
        title={t('legalHold.sections.activeHolds.title')}
        description={t('legalHold.sections.activeHolds.description')}
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setBulkOpen(true)}
            >
              {t('legalHold.actions.bulkPlace')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setPlaceOpen(true)}
            >
              <Lock className="mr-1.5 size-4" aria-hidden />
              {t('legalHold.actions.placeHold')}
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <Select
            id="active-holds-targettype-filter"
            size="sm"
            value={targetTypeFilter}
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select onValueChange yields string; options are constrained to TargetType | 'all'
            onValueChange={(v) => setTargetTypeFilter(v as TargetType | 'all')}
            options={targetTypeOptions}
            aria-label={t('legalHold.filters.allTargets')}
          />
        </div>
        <DataTable<LegalHoldRow>
          columns={columns}
          data={rows ?? []}
          isLoading={isLoading}
          approxRowCount={rows?.length}
          getRowId={(row) => row._id}
          emptyState={{
            title: t('legalHold.sections.activeHolds.empty.title'),
            description: t('legalHold.sections.activeHolds.empty.description'),
          }}
          caption={t('legalHold.sections.activeHolds.title')}
        />
      </PageSection>

      <PlaceHoldDialog
        open={placeOpen}
        onOpenChange={setPlaceOpen}
        organizationId={organizationId}
      />
      <BulkPlaceDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        organizationId={organizationId}
      />
      <RequestReleaseDialog
        open={releaseHoldId !== undefined}
        onOpenChange={(next) => {
          if (!next) setReleaseHoldId(undefined);
        }}
        holdId={releaseHoldId}
      />
    </>
  );
}
