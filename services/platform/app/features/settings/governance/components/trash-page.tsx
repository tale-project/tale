'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { Row } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';
import { Trash2, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import {
  DataTableFilters,
  type FilterConfig,
} from '@/app/components/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useRestoreSoftDeletedRow } from '@/app/features/settings/governance/hooks/mutations';
import { useListTrashedRows } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import {
  SOFT_DELETE_RESOURCE_TYPES,
  type SoftDeleteResourceType,
} from '@/convex/governance/soft_delete_validators';
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

/** Placeholder rows shown while the first page loads (see `TrashPageView`). */
const PLACEHOLDER_ROW_COUNT = 5;

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
// Single page — owns data fetching, pagination/filter state, the access check,
// the restore mutation, and the loading state. Renders the REAL `SettingsSection` +
// trash table once, always, wrapped in `<Skeletonize>` (no horizontal/vertical
// shift on load). While loading, the table renders fixed PLACEHOLDER rows (same
// cell count/height) so an empty body never reads as "nothing trashed"; the
// real empty-state shows only once loaded with zero rows.
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
  // once the user clicks Load more.
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
  // Subsequent-page fetch (Load more clicked): keep showing the accumulated
  // rows; only the load-more affordance reflects the in-flight state.
  const isLoadingMore = trash.isLoading && !isFirstPageLoading;
  const hasMore = Boolean(trash.data?.nextCursor);
  const loading = isFirstPageLoading;
  const rows = visibleRows;
  const onClearFilters =
    selectedTypes.length > 0 ? handleClearFilters : undefined;
  const onLoadMore = handleLoadMore;
  const onRequestRestore = setRestoreTarget;

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
        {/* Filters live OUTSIDE the Skeletonize so the type checkboxes and
            clear-all stay interactive (and unmasked) while a filter change
            refetches the first page — only the table body should skeletonize. */}
        <DataTableFilters filters={filterConfigs} onClearAll={onClearFilters} />

        <Skeletonize loading={loading} label={t('trash.title', 'Trash')}>
          {!loading && rows.length === 0 ? (
            <EmptyState
              icon={Trash2}
              title={t('trash.emptyTitle', 'Trash is empty')}
              description={t(
                'trash.empty',
                'Nothing in the trash. Retention will move expired rows here once their grace window starts.',
              )}
            />
          ) : (
            <Card padding="none" className="overflow-hidden">
              <Table className="min-w-[44rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">
                      {t('trash.column.type', 'Type')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('trash.column.name', 'Name')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('trash.column.owner', 'Owner')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('trash.column.status', 'Status')}
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      {t('trash.column.statusChangedAt', 'Trashed')}
                    </TableHead>
                    <TableHead className="text-right whitespace-nowrap">
                      {t('trash.column.actions', 'Actions')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? Array.from({ length: PLACEHOLDER_ROW_COUNT }).map(
                        (_, i) => (
                          <TableRow key={`placeholder-${i}`}>
                            <TableCell>
                              <SkeletonBox>
                                <div className="h-3.5 w-16" />
                              </SkeletonBox>
                            </TableCell>
                            <TableCell>
                              <SkeletonBox>
                                <div className="h-3.5 w-32" />
                              </SkeletonBox>
                            </TableCell>
                            <TableCell>
                              <SkeletonBox>
                                <div className="h-3.5 w-24" />
                              </SkeletonBox>
                            </TableCell>
                            <TableCell>
                              <SkeletonBox>
                                <div className="h-5 w-16 rounded" />
                              </SkeletonBox>
                            </TableCell>
                            <TableCell>
                              <SkeletonBox>
                                <div className="h-3.5 w-20" />
                              </SkeletonBox>
                            </TableCell>
                            <TableCell>
                              <SkeletonBox fullWidth>
                                <div className="ml-auto h-8 w-20 rounded-md" />
                              </SkeletonBox>
                            </TableCell>
                          </TableRow>
                        ),
                      )
                    : rows.map((row) => (
                        <TableRow
                          key={`${row.resourceType}:${row.id}`}
                          className="hover:bg-muted/20"
                        >
                          <TableCell className="text-muted-foreground text-xs">
                            {t(
                              `trash.tab.${row.resourceType}`,
                              row.resourceType,
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.displayName ?? row.id}
                          </TableCell>
                          <TableCell
                            className={
                              row.ownerName
                                ? 'text-muted-foreground text-xs'
                                : 'text-muted-foreground font-mono text-xs'
                            }
                          >
                            {row.ownerName ?? row.ownerId ?? '—'}
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                row.status === 'expired'
                                  ? 'rounded bg-orange-500/20 px-2 py-0.5 text-xs text-orange-700 dark:text-orange-300'
                                  : 'rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-700 dark:text-yellow-300'
                              }
                            >
                              {t(`trash.status.${row.status}`, row.status)}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            <TableDateCell
                              date={row.statusChangedAt ?? row.createdAt}
                              preset="relative"
                              className="text-xs"
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="secondary"
                              icon={Undo2}
                              onClick={() =>
                                onRequestRestore({
                                  resourceType: row.resourceType,
                                  rowId: row.id,
                                  displayName: row.displayName ?? row.id,
                                  status: row.status,
                                })
                              }
                            >
                              {/* Icon-only on mobile; the label stays in the
                                a11y tree via `sr-only` so the button keeps
                                its accessible name. */}
                              <span className="max-sm:sr-only">
                                {t('trash.restore.label', 'Restore')}
                              </span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
              {/* The load-more row reserves its height in both states (masked
              while the first page loads), so revealing it never pushes the
              page. It only shows the real button once more pages exist. */}
              {(loading || hasMore) && (
                <Row
                  gap={0}
                  align="stretch"
                  justify="center"
                  // Same footer chrome as the shared DataTable's load-more —
                  // centered, no divider — so paging reads identically on
                  // every table.
                  className="py-3"
                >
                  {loading ? (
                    <SkeletonBox>
                      <div className="h-8 w-24 rounded-md" />
                    </SkeletonBox>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={isLoadingMore}
                      onClick={onLoadMore}
                    >
                      {isLoadingMore
                        ? tCommon('actions.loading')
                        : t('trash.loadMore', 'Load more')}
                    </Button>
                  )}
                </Row>
              )}
            </Card>
          )}
        </Skeletonize>
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
