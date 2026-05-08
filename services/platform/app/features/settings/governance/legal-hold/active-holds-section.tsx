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
import { PlaceHoldDialog } from './place-hold-dialog';
import { RequestReleaseDialog } from './request-release-dialog';

/** Picker filter options. The mutation API still accepts thread /
 *  document / execution as targetType (for legacy data), but the
 *  operator UI only filters by the supported user-facing scopes plus a
 *  catch-all 'all'. */
const FILTER_TARGET_TYPES = ['userMembership', 'org'] as const;
type FilterTargetType = (typeof FILTER_TARGET_TYPES)[number];

const LEGACY_TARGET_TYPES = new Set<string>([
  'thread',
  'document',
  'execution',
]);

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
  const [targetTypeFilter, setTargetTypeFilter] = useState<
    FilterTargetType | 'all'
  >('all');
  const [placeOpen, setPlaceOpen] = useState(false);
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
      ...FILTER_TARGET_TYPES.map((value) => ({
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
        cell: ({ row }) => {
          const isLegacy = LEGACY_TARGET_TYPES.has(row.original.targetType);
          return (
            <Badge variant={isLegacy ? 'outline' : 'blue'}>
              {t(`legalHold.targetTypes.${row.original.targetType}`)}
              {isLegacy ? ` ${t('legalHold.columns.legacy')}` : ''}
            </Badge>
          );
        },
        size: 150,
      },
      {
        accessorKey: 'targetLabel',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Text as="span" truncate title={row.original.targetLabel}>
              {row.original.targetLabel}
            </Text>
            <Text
              as="span"
              variant="muted"
              truncate
              className="font-mono text-xs"
              title={row.original.targetId}
            >
              {row.original.targetId}
            </Text>
          </div>
        ),
        size: 240,
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
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setPlaceOpen(true)}
          >
            <Lock className="mr-1.5 size-4" aria-hidden />
            {t('legalHold.actions.placeHold')}
          </Button>
        }
      >
        <div className="flex items-center gap-2">
          <Select
            id="active-holds-targettype-filter"
            size="sm"
            value={targetTypeFilter}
            onValueChange={(v) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select onValueChange yields string; options are constrained to FilterTargetType | 'all'
              setTargetTypeFilter(v as FilterTargetType | 'all')
            }
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
