'use client';

import { Button } from '@tale/ui/button';
import { Skeleton } from '@tale/ui/skeleton';
import { Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  DataTableFilters,
  type FilterConfig,
} from '@/app/components/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { useRestoreSoftDeletedRow } from '@/app/features/settings/governance/hooks/mutations';
import { useListTrashedRows } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import {
  SOFT_DELETE_RESOURCE_TYPES,
  type SoftDeleteResourceType,
} from '@/convex/governance/soft_delete_validators';
import { useT } from '@/lib/i18n/client';

interface Props {
  organizationId: string;
}

const VISIBLE_RESOURCE_TYPES: readonly SoftDeleteResourceType[] =
  SOFT_DELETE_RESOURCE_TYPES.filter(
    (t) => t !== 'messageMetadata' && t !== 'workflowTriggerLog',
  );

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
}

interface TrashCursor {
  ts: number;
  id: string;
}

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

  if (ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={t('trash.accessDenied', 'Admin only.')} />;
  }

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
      const message = err instanceof Error ? err.message : 'Restore failed';
      toast({
        title: t('trash.restore.failedToast', 'Failed to restore'),
        description: message,
        variant: 'destructive',
      });
    }
  };

  const isFirstPageLoading =
    trash.isLoading && cursor === null && loadedPages.length === 0;
  const hasMore = Boolean(trash.data?.nextCursor);

  return (
    <PageSection
      title={t('trash.title', 'Trash')}
      description={t(
        'trash.description',
        'Recover retention-trashed records before they are permanently deleted at the end of the grace window.',
      )}
    >
      <DataTableFilters
        filters={filterConfigs}
        onClearAll={selectedTypes.length > 0 ? handleClearFilters : undefined}
      />

      {isFirstPageLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="border-border rounded-md border p-8 text-center">
          <Text className="text-muted-foreground text-sm">
            {t(
              'trash.empty',
              'Nothing in the trash. Retention will move expired rows here once their grace window starts.',
            )}
          </Text>
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-border border-b">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.type', 'Type')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.name', 'Name')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.status', 'Status')}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t('trash.column.statusChangedAt', 'Trashed')}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('trash.column.actions', 'Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {visibleRows.map((row) => (
                <tr
                  key={`${row.resourceType}:${row.id}`}
                  className="hover:bg-muted/20"
                >
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {t(`trash.tab.${row.resourceType}`, row.resourceType)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.displayName ?? row.id}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        row.status === 'expired'
                          ? 'rounded bg-orange-500/15 px-2 py-0.5 text-xs text-orange-600'
                          : 'rounded bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-700'
                      }
                    >
                      {t(`trash.status.${row.status}`, row.status)}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {formatRelative(row.statusChangedAt ?? row.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Undo2}
                      onClick={() =>
                        setRestoreTarget({
                          resourceType: row.resourceType,
                          rowId: row.id,
                          displayName: row.displayName ?? row.id,
                          status: row.status,
                        })
                      }
                    >
                      {t('trash.restore.label', 'Restore')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className="border-border flex justify-center border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={trash.isLoading}
                onClick={handleLoadMore}
              >
                {trash.isLoading
                  ? tCommon('actions.loading')
                  : t('trash.loadMore', 'Load more')}
              </Button>
            </div>
          )}
        </div>
      )}

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
    </PageSection>
  );
}

function formatRelative(ms: number): string {
  const elapsedMs = Date.now() - ms;
  if (elapsedMs < 60_000) return 'just now';
  const days = Math.floor(elapsedMs / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const minutes = Math.floor(elapsedMs / 60_000);
  return `${minutes}m ago`;
}
