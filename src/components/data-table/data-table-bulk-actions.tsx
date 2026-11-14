'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { useT } from '@tale/ui/i18n/client';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import type { RowSelectionState } from '@tanstack/react-table';
import { Archive, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

interface BulkDeleteBarProps {
  /** Current row selection state (keyed by row ID) */
  rowSelection: RowSelectionState;
  onRowSelectionChange: (selection: RowSelectionState) => void;
  getItemLabel?: (id: string) => string;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Async function to delete a single item by ID */
  onDeleteItem: (id: string) => Promise<void>;
  /** Callback after all selected deletions succeed */
  onDeleteComplete?: () => void;
  /**
   * The words under the failure toast, read from what each refused delete
   * threw, in selection order (for example the first refusal's reason, read
   * through a helper that never shows an error's payload). This toast is the
   * batch's only report, so `onDeleteItem` keeps its own quiet. Without it
   * the toast carries only its title.
   */
  describeFailure?: (reasons: unknown[]) => string | undefined;
}

interface BulkArchiveBarProps {
  /** Current row selection state (keyed by row ID) */
  rowSelection: RowSelectionState;
  onRowSelectionChange: (selection: RowSelectionState) => void;
  getItemLabel?: (id: string) => string;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Async function to archive a single item by ID */
  onArchiveItem: (id: string) => Promise<void>;
  /** Callback after all selected archives succeed */
  onComplete?: () => void;
  /**
   * The words under the failure toast, read from what each refused archive
   * threw, in selection order — as `BulkDeleteBar`'s `describeFailure`.
   * Without it the toast carries only its title.
   */
  describeFailure?: (reasons: unknown[]) => string | undefined;
}

function selectedIdsFrom(rowSelection: RowSelectionState): string[] {
  return Object.keys(rowSelection).filter((key) => rowSelection[key]);
}

export function BulkDeleteBar({
  rowSelection,
  onRowSelectionChange,
  getItemLabel,
  onClearSelection,
  onDeleteItem,
  onDeleteComplete,
  describeFailure,
}: BulkDeleteBarProps) {
  const { t } = useT('common');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [failure, setFailure] = useState<{
    items: { id: string; label: string }[];
    detail?: string;
  }>();

  const selectedIds = selectedIdsFrom(rowSelection);
  const count = selectedIds.length;

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => Promise.resolve().then(() => onDeleteItem(id))),
      );
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      const successCount = count - refused.length;

      if (refused.length > 0) {
        const failedIds = selectedIds.filter(
          (_, index) => results[index]?.status === 'rejected',
        );
        const detail = describeFailure?.(
          refused.map((result) => result.reason),
        );
        setFailure({
          items: failedIds.map((id) => ({
            id,
            label: getItemLabel?.(id) ?? id,
          })),
          detail,
        });
        onRowSelectionChange(
          Object.fromEntries(failedIds.map((id) => [id, true])),
        );
        toast({
          title: t('bulkActions.deleteFailed'),
          description: detail,
          variant: 'destructive',
        });
        return;
      } else {
        toast({
          title: t('bulkActions.deleteSuccess', { count: successCount }),
        });
      }

      setIsConfirmOpen(false);
      setFailure(undefined);
      onClearSelection();
      onDeleteComplete?.();
    } finally {
      setIsDeleting(false);
    }
  }, [
    selectedIds,
    count,
    onDeleteItem,
    onClearSelection,
    onDeleteComplete,
    describeFailure,
    getItemLabel,
    onRowSelectionChange,
    t,
  ]);

  if (count === 0) return null;

  return (
    <>
      <div className="bg-muted/80 border-border animate-in fade-in slide-in-from-bottom-2 flex items-center justify-between rounded-lg border px-4 py-2 duration-200">
        <HStack gap={3}>
          <Text as="span" variant="label" className="text-sm">
            {t('bulkActions.itemsSelected', { count })}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            aria-label={t('actions.clearAll')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setFailure(undefined);
            setIsConfirmOpen(true);
          }}
        >
          <Trash2 className="mr-1.5 size-4" />
          {t('actions.deleteSelected')}
        </Button>
      </div>

      <DeleteDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={t('bulkActions.confirmDeleteTitle', { count })}
        description={t('bulkActions.confirmDeleteDescription', { count })}
        onDelete={handleDelete}
        isDeleting={isDeleting}
        deletingText={t('bulkActions.deleting')}
      >
        {failure && (
          <Alert variant="destructive" title={t('bulkActions.deleteFailed')}>
            {failure.detail && <p>{failure.detail}</p>}
            <ul>
              {failure.items.map((item) => (
                <li key={item.id}>{item.label}</li>
              ))}
            </ul>
          </Alert>
        )}
      </DeleteDialog>
    </>
  );
}

/**
 * Selection footer for reversible bulk archive. Same chrome as
 * `BulkDeleteBar`, but the action is archive (ConfirmDialog, non-destructive
 * button) — use this for high-value entities that must not offer bulk delete.
 */
export function BulkArchiveBar({
  rowSelection,
  onRowSelectionChange,
  getItemLabel,
  onClearSelection,
  onArchiveItem,
  onComplete,
  describeFailure,
}: BulkArchiveBarProps) {
  const { t } = useT('common');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [failure, setFailure] = useState<{
    items: { id: string; label: string }[];
    detail?: string;
  }>();

  const selectedIds = selectedIdsFrom(rowSelection);
  const count = selectedIds.length;

  const handleArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) =>
          Promise.resolve().then(() => onArchiveItem(id)),
        ),
      );
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      const successCount = count - refused.length;

      if (refused.length > 0) {
        const failedIds = selectedIds.filter(
          (_, index) => results[index]?.status === 'rejected',
        );
        const detail = describeFailure?.(
          refused.map((result) => result.reason),
        );
        setFailure({
          items: failedIds.map((id) => ({
            id,
            label: getItemLabel?.(id) ?? id,
          })),
          detail,
        });
        onRowSelectionChange(
          Object.fromEntries(failedIds.map((id) => [id, true])),
        );
        toast({
          title: t('bulkActions.archiveFailed'),
          description: detail,
          variant: 'destructive',
        });
        return;
      } else {
        toast({
          title: t('bulkActions.archiveSuccess', { count: successCount }),
        });
      }

      setIsConfirmOpen(false);
      setFailure(undefined);
      onClearSelection();
      onComplete?.();
    } finally {
      setIsArchiving(false);
    }
  }, [
    selectedIds,
    count,
    onArchiveItem,
    onClearSelection,
    onComplete,
    describeFailure,
    getItemLabel,
    onRowSelectionChange,
    t,
  ]);

  if (count === 0) return null;

  return (
    <>
      <div className="bg-muted/80 border-border animate-in fade-in slide-in-from-bottom-2 flex items-center justify-between rounded-lg border px-4 py-2 duration-200">
        <HStack gap={3}>
          <Text as="span" variant="label" className="text-sm">
            {t('bulkActions.itemsSelected', { count })}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            aria-label={t('actions.clearAll')}
          >
            <X className="size-4" />
          </Button>
        </HStack>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFailure(undefined);
            setIsConfirmOpen(true);
          }}
        >
          <Archive className="mr-1.5 size-4" />
          {t('actions.archiveSelected')}
        </Button>
      </div>

      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title={t('bulkActions.confirmArchiveTitle', { count })}
        description={t('bulkActions.confirmArchiveDescription', { count })}
        confirmText={t('actions.archiveSelected')}
        loadingText={t('bulkActions.archiving')}
        isLoading={isArchiving}
        onConfirm={() => void handleArchive()}
      >
        {failure && (
          <Alert variant="destructive" title={t('bulkActions.archiveFailed')}>
            {failure.detail && <p>{failure.detail}</p>}
            <ul>
              {failure.items.map((item) => (
                <li key={item.id}>{item.label}</li>
              ))}
            </ul>
          </Alert>
        )}
      </ConfirmDialog>
    </>
  );
}
