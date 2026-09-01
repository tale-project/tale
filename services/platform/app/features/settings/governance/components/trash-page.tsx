'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useRestoreSoftDeletedRow } from '@/app/features/settings/governance/hooks/mutations';
import { useListTrashedRows } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import {
  SOFT_DELETE_RESOURCE_TYPES,
  type SoftDeleteResourceType,
} from '@/backend/core/governance/soft_delete';
import { useT } from '@/lib/i18n/client';

import { mapGovernanceSaveError } from '../governance-save-errors';

interface Props {
  organizationId: string;
}

// Trash UI surfaces every soft-deletable resource — the registry no
// longer carries cascade-only types (messageMetadata, workflowTriggerLog)
// after the round-2 V2 P1-A/B cleanup, so this is now an alias.
const VISIBLE_RESOURCE_TYPES: readonly SoftDeleteResourceType[] =
  SOFT_DELETE_RESOURCE_TYPES;

interface RestoreTarget {
  resourceType: SoftDeleteResourceType;
  rowId: string;
  displayName: string;
  status: 'trashed' | 'expired';
}

interface TrashRow {
  resourceType: SoftDeleteResourceType;
  id: string;
  status: 'trashed' | 'expired';
  statusChangedAt: number | null;
  createdAt: number;
  displayName: string | null;
  ownerId: string | null;
  ownerName: string | null;
}

interface TrashCursor {
  ts: number;
  id: string;
}

// =============================================================================
// Single page — owns data fetching, cursor pagination/filter state, the access
// check, and the restore mutation. Rendering is the shared `DataTable`, so the
// loading skeleton, the empty state (inside the bordered frame, headers
// hidden), the filtered-empty state (headers kept, "no results" copy), the
// disabled filter button on a genuinely empty trash, and the load-more chrome
// all read exactly like every other table.
// =============================================================================
export function TrashPage({ organizationId }: Props) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const { toast } = useToast();

  // Selected resource types (multi-select). Empty array = "all visible
  // categories", which is the default and most useful entry point —
  // admin opens the page to see what's actually in the trash.
  const [selectedTypes, setSelectedTypes] = useState<SoftDeleteResourceType[]>(
    [],
  );

  // Cursor-based pagination: `cursor` is what we're currently fetching
  // with (null = first page); `loadedPages` accumulates earlier pages
  // once the user loads more.
  const [cursor, setCursor] = useState<TrashCursor | null>(null);
  const [loadedPages, setLoadedPages] = useState<TrashRow[][]>([]);

  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(
    null,
  );

  const queryArgs = useMemo(
    () => ({
      resourceTypes: selectedTypes.length > 0 ? selectedTypes : undefined,
      cursor,
    }),
    [selectedTypes, cursor],
  );
  const trash = useListTrashedRows(organizationId, queryArgs, true);
  const restoreMutation = useRestoreSoftDeletedRow();

  const resetPagination = useCallback(() => {
    setCursor(null);
    setLoadedPages([]);
  }, []);

  const handleFilterChange = useCallback(
    (values: string[]) => {
      const next: SoftDeleteResourceType[] = [];
      for (const value of values) {
        for (const rt of VISIBLE_RESOURCE_TYPES) {
          if (rt === value) {
            next.push(rt);
            break;
          }
        }
      }
      setSelectedTypes(next);
      resetPagination();
    },
    [resetPagination],
  );

  const handleClearFilters = useCallback(() => {
    setSelectedTypes([]);
    resetPagination();
  }, [resetPagination]);

  const handleLoadMore = useCallback(() => {
    if (!trash.data?.nextCursor) return;
    setLoadedPages((prev) => [...prev, trash.data.rows]);
    setCursor(trash.data.nextCursor);
  }, [trash.data]);

  const filterConfigs: FilterConfig[] = useMemo(
    () => [
      {
        key: 'resourceType',
        title: t('trash.filterTitle', 'Category'),
        multiSelect: true,
        columns: 2,
        options: VISIBLE_RESOURCE_TYPES.map((rt) => ({
          value: rt,
          label: t(`trash.tab.${rt}`, rt),
        })),
        selectedValues: selectedTypes,
        onChange: handleFilterChange,
      },
    ],
    [t, selectedTypes, handleFilterChange],
  );

  const visibleRows: TrashRow[] = useMemo(
    () => [...loadedPages.flat(), ...(trash.data?.rows ?? [])],
    [loadedPages, trash.data],
  );

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await restoreMutation.mutateAsync({
        organizationId,
        resourceType: restoreTarget.resourceType,
        rowId: restoreTarget.rowId,
      });
      toast({
        title: t('trash.restore.restoredToast', 'Restored.'),
        variant: 'success',
      });
      setRestoreTarget(null);
      // Restored row mutates the trash pool — drop accumulated pages
      // and let the live first-page query repaint. Simpler than
      // surgically removing the row from `loadedPages`.
      resetPagination();
    } catch (err) {
      toast({
        title: t('trash.restore.failedToast', 'Failed to restore'),
        description: mapGovernanceSaveError(
          err,
          t,
          t(
            'trash.restore.failedDescription',
            'Failed to restore this record.',
          ),
        ),
        variant: 'destructive',
      });
    }
  };

  const isFirstPageLoading =
    trash.isLoading && cursor === null && loadedPages.length === 0;
  // Subsequent-page fetch (load more): keep showing the accumulated rows;
  // only the load-more affordance reflects the in-flight state.
  const isLoadingMore = trash.isLoading && !isFirstPageLoading;
  const hasMore = Boolean(trash.data?.nextCursor);

  const columns = useMemo<ColumnDef<TrashRow>[]>(
    () => [
      {
        id: 'type',
        header: t('trash.column.type', 'Type'),
        cell: ({ row }) => {
          const label = t(
            `trash.tab.${row.original.resourceType}`,
            row.original.resourceType,
          );
          return (
            <Text
              as="span"
              variant="muted"
              truncate
              title={label}
              className="text-xs"
            >
              {label}
            </Text>
          );
        },
        // Wide enough for the longest category label across locales
        // ("Externe Konversationen"); anything longer truncates with a title.
        size: 140,
      },
      {
        id: 'name',
        header: t('trash.column.name', 'Name'),
        // The one prose-ish column: it alone absorbs the container slack
        // while the siblings keep their declared px.
        meta: { flex: true },
        cell: ({ row }) => {
          const name = row.original.displayName ?? row.original.id;
          return (
            <Text as="span" truncate title={name} className="font-mono text-xs">
              {name}
            </Text>
          );
        },
        size: 150,
      },
      {
        id: 'owner',
        header: t('trash.column.owner', 'Owner'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            truncate
            className={row.original.ownerName ? 'text-xs' : 'font-mono text-xs'}
          >
            {row.original.ownerName ?? row.original.ownerId ?? '—'}
          </Text>
        ),
        size: 130,
      },
      {
        id: 'status',
        header: t('trash.column.status', 'Status'),
        cell: ({ row }) => (
          <span
            className={
              row.original.status === 'expired'
                ? 'rounded bg-orange-500/20 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-300'
                : 'rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300'
            }
          >
            {t(`trash.status.${row.original.status}`, row.original.status)}
          </span>
        ),
        // Fits the widest status badge across locales ("Mis à la corbeille",
        // ~112px) on one line.
        size: 128,
      },
      {
        id: 'statusChangedAt',
        header: t('trash.column.statusChangedAt', 'Trashed'),
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.statusChangedAt ?? row.original.createdAt}
            preset="relative"
            className="text-xs"
          />
        ),
        // Relative dates run long ("il y a quelques secondes", ~141px) and
        // the cell doesn't wrap — keep enough room that the text never
        // slides under the Restore column.
        size: 156,
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">
            {t('trash.column.actions', 'Actions')}
          </span>
        ),
        // Wider than the canonical 3-dot actions column: restore is the
        // page's whole purpose, so it stays a labelled inline button
        // instead of collapsing into a dropdown. Sized for the widest
        // label across locales ("Wiederherstellen", ~171px rendered).
        size: 188,
        meta: { isAction: true },
        cell: ({ row }) => (
          <Button
            variant="secondary"
            icon={Undo2}
            onClick={() =>
              setRestoreTarget({
                resourceType: row.original.resourceType,
                rowId: row.original.id,
                displayName: row.original.displayName ?? row.original.id,
                status: row.original.status,
              })
            }
          >
            {/* Icon-only on mobile; the label stays in the a11y tree via
                `sr-only` so the button keeps its accessible name. */}
            <span className="max-sm:sr-only">
              {t('trash.restore.label', 'Restore')}
            </span>
          </Button>
        ),
      },
    ],
    [t],
  );

  // Access gate is a real authorization branch, not a loading swap.
  if (ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={t('trash.accessDenied', 'Admin only.')} />;
  }

  return (
    <>
      <SettingsSection
        title={t('trash.title', 'Trash')}
        description={t(
          'trash.description',
          'Recover retention-trashed records before they are permanently deleted at the end of the grace window.',
        )}
      >
        <DataTable<TrashRow>
          columns={columns}
          data={visibleRows}
          isLoading={isFirstPageLoading}
          // `undefined` while the first page (or a filter change) is in
          // flight — DataTable shows its standard skeleton instead of
          // flashing the empty state before the count is known.
          approxRowCount={
            trash.data === undefined ? undefined : visibleRows.length
          }
          getRowId={(row) => `${row.resourceType}:${row.id}`}
          filters={filterConfigs}
          onClearFilters={handleClearFilters}
          infiniteScroll={{
            // Keep the affordance up while a page fetch is in flight so the
            // footer doesn't flash "showing all" between pages.
            hasMore: hasMore || isLoadingMore,
            onLoadMore: handleLoadMore,
            isLoadingMore,
            isInitialLoading: isFirstPageLoading,
            entityLabel: {
              one: t('trash.entityLabelOne', 'record'),
              other: t('trash.entityLabel', 'records'),
            },
          }}
          emptyState={{
            icon: Trash2,
            title: t('trash.emptyTitle', 'Trash is empty'),
            description: t(
              'trash.empty',
              'Nothing in the trash. Retention will move expired rows here once their grace window starts.',
            ),
          }}
          caption={t('trash.title', 'Trash')}
        />
      </SettingsSection>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title={
          restoreTarget?.status === 'expired'
            ? t(
                'trash.restore.expiredTitle',
                'Restore retention-expired record?',
              )
            : t('trash.restore.trashedTitle', 'Restore record?')
        }
        description={
          restoreTarget?.status === 'expired'
            ? t(
                'trash.restore.expiredDescription',
                'This record was deleted by retention policy. Restoring overrides that policy and brings the record back to active. Audited.',
              )
            : t(
                'trash.restore.trashedDescription',
                'Bring this record back to active. It will return to its source list.',
              )
        }
        confirmText={t('trash.restore.confirm', 'Restore')}
        cancelText={tCommon('actions.cancel')}
        isLoading={restoreMutation.isPending}
        onConfirm={() => void handleRestore()}
        requireConfirmPhrase={
          restoreTarget?.status === 'expired' ? 'restore' : undefined
        }
        requireConfirmPhraseLabel={
          restoreTarget?.status === 'expired'
            ? t('trash.restore.expiredPhraseLabel', 'Type "restore" to confirm')
            : undefined
        }
      >
        {restoreTarget && (
          <Text className="text-muted-foreground font-mono text-xs">
            {restoreTarget.displayName}
          </Text>
        )}
      </ConfirmDialog>
    </>
  );
}
