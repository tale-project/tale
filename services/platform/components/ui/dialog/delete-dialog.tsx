'use client';

import * as React from 'react';
import { ConfirmDialog } from './confirm-dialog';
import { ItemPreview } from './item-preview';
import { Stack } from '../layout';
import { useT } from '@/lib/i18n';

export interface DeleteDialogProps {
  /** Whether the dialog is open */
  open?: boolean;
  /** Callback when the dialog open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Dialog title */
  title: string;
  /** Confirmation message - can be string or JSX */
  description?: React.ReactNode;
  /** Item preview data - shown as a preview box */
  preview?: {
    primary: string;
    secondary?: string;
  };
  /** Warning message to display in an amber warning box */
  warning?: string;
  /** Optional additional content for complex cases */
  children?: React.ReactNode;
  /** Text for the cancel button (defaults to common.actions.cancel) */
  cancelText?: string;
  /** Text for the delete button (defaults to common.actions.delete) */
  deleteText?: string;
  /** Text shown when deleting (defaults to common.actions.deleting) */
  deletingText?: string;
  /** Whether the deletion is in progress */
  isDeleting?: boolean;
  /** Callback when delete is confirmed */
  onDelete: () => void;
  /** Additional className for DialogContent */
  className?: string;
}

/**
 * Delete dialog - a specialized ConfirmDialog for delete actions.
 * Uses destructive styling by default.
 */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  preview,
  warning,
  children,
  cancelText,
  deleteText,
  deletingText,
  isDeleting = false,
  onDelete,
  className,
}: DeleteDialogProps) {
  const { t: tCommon } = useT('common');

  const hasContent = preview || warning || children;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      cancelText={cancelText ?? tCommon('actions.cancel')}
      confirmText={deleteText ?? tCommon('actions.delete')}
      loadingText={deletingText ?? tCommon('actions.deleting')}
      isLoading={isDeleting}
      onConfirm={onDelete}
      variant="destructive"
      className={className}
    >
      {hasContent && (
        <Stack gap={4}>
          {preview && (
            <ItemPreview primary={preview.primary} secondary={preview.secondary} />
          )}
          {warning && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200">{warning}</p>
            </div>
          )}
          {children}
        </Stack>
      )}
    </ConfirmDialog>
  );
}
