'use client';

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import type { FilterConfig } from '@tale/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/use-list-page';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useRestoreSoftDeletedRow } from '@/app/features/settings/governance/hooks/mutations';
import { useListTrashedRows } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { readStateOf } from '@/app/lib/backend/read-state';
import {
  TRASH_LISTED_RESOURCE_TYPES,
  type SoftDeleteResourceType,
  type TrashListedResourceType,
} from '@/backend/core/governance/soft_delete';
import { useT } from '@/lib/i18n/client';

import { mapGovernanceSaveError } from '../governance-save-errors';

interface Props {
  organizationId: string;
}

// The filter offers exactly the categories the server lists — the same
// list the trash registry is keyed by — so every option is a category with
// a label that can hold rows, and no category appears twice under two
// names (2026-09-26 evaluation, E-20/G-15).
const VISIBLE_RESOURCE_TYPES: readonly TrashListedResourceType[] =
  TRASH_LISTED_RESOURCE_TYPES;

interface RestoreTarget {
  resourceType: SoftDeleteResourceType;
  rowId: string;
  displayName: string;
  status: 'trashed' | 'expired';
}

// The contract's row shape — wider than the listed types on purpose, so a
// row of a type this build no longer lists still renders and restores.
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
  const [selectedTypes, setSelectedTypes] = useState<TrashListedResourceType[]>(
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
      // The shared list size, named here because the server's default is 50.
      // Not the Logs' larger page despite the same frame: why is in
      // `audit-logs/logs-page-size.ts`.
      limit: DEFAULT_LIST_PAGE_SIZE,
    }),
    [selectedTypes, cursor],
  );
  const trash = useListTrashedRows(organizationId, queryArgs, true);
  const { refetch: refetchTrash } = trash;
  const restoreMutation = useRestoreSoftDeletedRow();

  const resetPagination = useCallback(() => {
    setCursor(null);
    setLoadedPages([]);
  }, []);

  const handleFilterChange = useCallback(
    (values: string[]) => {
      const next: TrashListedResourceType[] = [];
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

  // A failed read is named, never passed off as an empty trash (#3641).
  // Rows already on screen — earlier pages, or the page a refresh failed to
  // renew — stay, and the failure is named above them.
  const retry = useCallback(() => void refetchTrash(), [refetchTrash]);
  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery({
      error: trash.error,
      results: visibleRows,
      retry,
    });
  // How the page being read stands; the flags hold through a retry, which
  // react-query starts from `pending` for a page that never answered.
  const read = readStateOf(trash);
  // The first page never answered: nothing about the trash is known, so an
  // alert stands where the table would be — announced, with a Try again
  // that stays focused and busy through its retry.
  const firstPageFailed = read.unavailable && visibleRows.length === 0;
  // The page after the loaded ones never answered: the rows end there, not
  // because the trash does.
  const nextPageFailed = failedWithRows && trash.data === undefined;
  // A refresh failed over what the trash last answered — rows, or none.
  const refreshFailed = failedWithRows || read.stale;

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
              className="block text-xs"
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
            <Text
              as="span"
              truncate
              title={name}
              className="block font-mono text-xs"
            >
              {name}
            </Text>
          );
        },
        size: 150,
      },
      {
        id: 'owner',
        header: t('trash.column.owner', 'Owner'),
        // `block`, like every text cell here: `truncate` only clips a box
        // with the cell's width — as a bare inline span, an owner name that
        // is one unbreakable token painted over the Status badge.
        cell: ({ row }) => {
          const owner = row.original.ownerName ?? row.original.ownerId ?? '—';
          return (
            <Text
              as="span"
              variant="muted"
              truncate
              title={owner}
              className={
                row.original.ownerName
                  ? 'block text-xs'
                  : 'block font-mono text-xs'
              }
            >
              {owner}
            </Text>
          );
        },
        size: 180,
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
      {/* `fullWidth`: the trash columns declare a ~940px size floor
          (type/name/owner/status/trashed + the labelled Restore button) —
          wider than the `max-w-3xl` other settings pages standardized on
          (#2567), and clipping it hides the one control the page exists for.
          `fitToContainer`, with the section's `min-h-0 flex-1`, bounds the
          height the `stickyLayout` table needs to own its own scrollport: the
          rows scroll under a pinned header and footer instead of growing the
          page — the same fixed frame the Logs table renders in. */}
      <SettingsPage fitToContainer fullWidth>
        <SettingsSection
          // The list's region: a retry that takes its control away hands the
          // focus here, not to the page.
          ref={regionRef}
          tabIndex={-1}
          title={t('trash.title', 'Trash')}
          description={t(
            'trash.description',
            'Recover retention-trashed records before they are permanently deleted at the end of the grace window.',
          )}
          className="min-h-0 flex-1 outline-none"
        >
          {firstPageFailed ? (
            <CatalogLoadError
              // Each failure is announced again. Try again keeps its node,
              // and the focus on it, through the retry; once the records
              // answer, the focus goes to the section.
              failureKey={read.failureCount}
              onFocusLost={focusRegion}
              message={t(
                'trash.loadFailed',
                "Couldn't load the records in Trash.",
              )}
              onRetry={retry}
              isRetrying={read.retrying}
            />
          ) : (
            <>
              {refreshFailed && (
                <CatalogLoadError
                  // Each failure is announced again; Try again keeps its node.
                  failureKey={trash.errorUpdateCount}
                  onFocusLost={focusRegion}
                  message={t(
                    'trash.refreshFailed',
                    "Couldn't load the latest records. What's listed may be incomplete or out of date.",
                  )}
                  onRetry={retryRead}
                  isRetrying={trash.isFetching}
                />
              )}
              <DataTable<TrashRow>
                columns={columns}
                stickyLayout
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
                  // Scrolling asks for nothing until Try again, and the footer
                  // says the rest could not be loaded instead of "Showing all".
                  loadFailed: nextPageFailed,
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
            </>
          )}
        </SettingsSection>
      </SettingsPage>

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
