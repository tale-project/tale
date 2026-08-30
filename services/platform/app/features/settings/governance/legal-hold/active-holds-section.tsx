'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Lock, LockOpen } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { isFilterAffordanceDisabled } from '@/app/components/ui/filters/filter-panel';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
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
  const [releaseHoldId, setReleaseHoldId] = useState<string | undefined>(
    undefined,
  );

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

  // Column sizes double as the table's min-width floor (DataTable sums them).
  // Keep the total ≤ 940px so the table fits the settings content column on
  // common laptop widths instead of clipping behind a horizontal scroll.
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
        meta: { skeleton: { type: 'badge' as const } },
        size: 120,
      },
      {
        accessorKey: 'targetLabel',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
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
          </Stack>
        ),
        meta: { skeleton: { type: 'two-line' as const } },
        size: 180,
      },
      {
        accessorKey: 'reason',
        header: t('legalHold.columns.reason'),
        // `truncate` is overflow:hidden + ellipsis, and neither does anything to
        // an INLINE span — so a long reason painted straight over the Matter,
        // Placed by and Placed columns. The min-w-0 block wrapper is what gives
        // the ellipsis a box to clip against (same shape as the target cell).
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
            <Text as="span" truncate title={row.original.reason}>
              {row.original.reason}
            </Text>
          </Stack>
        ),
        size: 130,
      },
      {
        accessorKey: 'matterName',
        header: t('legalHold.columns.matter'),
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
            {row.original.matterName ? (
              <Text
                as="span"
                variant="muted"
                truncate
                title={row.original.matterName}
              >
                {row.original.matterName}
              </Text>
            ) : (
              <Text as="span" variant="muted">
                —
              </Text>
            )}
          </Stack>
        ),
        size: 120,
      },
      {
        accessorKey: 'placedByName',
        header: t('legalHold.columns.placedBy'),
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
            <Text as="span" truncate title={row.original.placedByName}>
              {row.original.placedByName}
            </Text>
          </Stack>
        ),
        size: 130,
      },
      {
        accessorKey: 'placedAt',
        header: t('legalHold.columns.placedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.placedAt} />,
        size: 120,
      },
      {
        id: 'actions',
        header: t('legalHold.columns.actions'),
        meta: { isAction: true, align: 'right' as const },
        cell: ({ row }) => (
          <Row gap={0} align="stretch" justify="end">
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              icon={LockOpen}
              aria-label={t('legalHold.actions.requestRelease')}
              onClick={(e) => {
                e.stopPropagation();
                setReleaseHoldId(row.original._id);
              }}
            />
          </Row>
        ),
        size: 140,
      },
    ],
    [t],
  );

  return (
    <>
      <SettingsSection
        title={t('legalHold.sections.activeHolds.title')}
        description={t('legalHold.sections.activeHolds.description')}
      >
        <DataTableFilters
          filters={[
            {
              key: 'targetType',
              title: t('legalHold.columns.target'),
              options: targetTypeOptions.filter((o) => o.value !== 'all'),
              selectedValues:
                targetTypeFilter === 'all' ? [] : [targetTypeFilter],
              onChange: (values) =>
                setTargetTypeFilter(
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options are constrained to FilterTargetType
                  (values[0] as FilterTargetType | undefined) ?? 'all',
                ),
            },
          ]}
          // See `matters-section`: a filter bar rendered outside its table has
          // to be told the set is empty.
          disabled={isFilterAffordanceDisabled({
            isLoading,
            itemCount: rows?.length ?? 0,
            hasActiveFilters: targetTypeFilter !== 'all',
          })}
          actions={
            <Button
              type="button"
              variant="primary"
              onClick={() => setPlaceOpen(true)}
            >
              <Lock className="mr-1.5 size-4" aria-hidden />
              {t('legalHold.actions.placeHold')}
            </Button>
          }
        />
        <DataTable<LegalHoldRow>
          columns={columns}
          data={rows ?? []}
          isLoading={isLoading}
          approxRowCount={rows?.length}
          getRowId={(row) => row._id}
          emptyState={{
            icon: Lock,
            title: t('legalHold.sections.activeHolds.empty.title'),
            description: t('legalHold.sections.activeHolds.empty.description'),
          }}
          caption={t('legalHold.sections.activeHolds.title')}
        />
      </SettingsSection>

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
