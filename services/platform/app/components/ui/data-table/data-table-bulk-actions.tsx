'use client';

import type { RowSelectionState } from '@tanstack/react-table';
import { Trash2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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

export function BulkDeleteBar({
  rowSelection,
  onClearSelection,
  onDeleteItem,
  onDeleteComplete,
}: BulkDeleteBarProps) {
  const { t } = useT('common');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedIds = Object.keys(rowSelection).filter(
    (key) => rowSelection[key],
  );
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
