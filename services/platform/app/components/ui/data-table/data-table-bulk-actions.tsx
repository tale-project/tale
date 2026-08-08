'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { RowSelectionState } from '@tanstack/react-table';
import { Archive, Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface BulkDeleteBarProps {
  /** Current row selection state (keyed by row ID) */
  rowSelection: RowSelectionState;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Async function to delete a single item by ID */
  onDeleteItem: (id: string) => Promise<void>;
  /** Callback after all deletions complete */
  onDeleteComplete?: () => void;
}

interface BulkArchiveBarProps {
  /** Current row selection state (keyed by row ID) */
  rowSelection: RowSelectionState;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Async function to archive a single item by ID */
  onArchiveItem: (id: string) => Promise<void>;
  /** Callback after all archives complete */
  onComplete?: () => void;
}

function selectedIdsFrom(rowSelection: RowSelectionState): string[] {
  return Object.keys(rowSelection).filter((key) => rowSelection[key]);
}

export function BulkDeleteBar({
  rowSelection,
  onClearSelection,
  onDeleteItem,
  onDeleteComplete,
}: BulkDeleteBarProps) {
  const { t } = useT('common');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedIds = selectedIdsFrom(rowSelection);
  const count = selectedIds.length;

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => onDeleteItem(id)),
      );
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      const successCount = count - failedCount;

      if (failedCount > 0) {
        toast({
          title: t('bulkActions.deleteFailed'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('bulkActions.deleteSuccess', { count: successCount }),
        });
      }

      setIsConfirmOpen(false);
      onClearSelection();
      onDeleteComplete?.();
    } finally {
      setIsDeleting(false);
    }
  }, [selectedIds, count, onDeleteItem, onClearSelection, onDeleteComplete, t]);

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
          onClick={() => setIsConfirmOpen(true)}
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
      />
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
  onClearSelection,
  onArchiveItem,
  onComplete,
}: BulkArchiveBarProps) {
  const { t } = useT('common');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const selectedIds = selectedIdsFrom(rowSelection);
  const count = selectedIds.length;

  const handleArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => onArchiveItem(id)),
      );
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      const successCount = count - failedCount;

      if (failedCount > 0) {
        toast({
          title: t('bulkActions.archiveFailed'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('bulkActions.archiveSuccess', { count: successCount }),
        });
      }

      setIsConfirmOpen(false);
      onClearSelection();
      onComplete?.();
    } finally {
      setIsArchiving(false);
    }
  }, [selectedIds, count, onArchiveItem, onClearSelection, onComplete, t]);

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
          onClick={() => setIsConfirmOpen(true)}
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
      />
    </>
  );
}
