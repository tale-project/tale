'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';

export interface ConfirmModalProps {
  /** Whether the modal is open */
  open?: boolean;
  /** Callback when the modal open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Modal title */
  title: string;
  /** Confirmation message - can be string or JSX */
  description?: React.ReactNode;
  /** Optional additional content (e.g., preview of item being deleted) */
  children?: React.ReactNode;
  /** Text for the cancel button (defaults to common.actions.cancel) */
  cancelText?: string;
  /** Text for the confirm button (defaults to common.actions.confirm) */
  confirmText?: string;
  /** Text shown when loading (defaults to common.actions.loading) */
  loadingText?: string;
  /** Whether the modal is in a loading state */
  isLoading?: boolean;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Variant of the modal - affects confirm button styling */
  variant?: 'default' | 'destructive';
  /** Additional className for DialogContent */
  className?: string;
}

/**
 * Confirmation modal for actions like delete, archive, etc.
 * Provides a consistent confirmation UI with optional preview content.
 */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancelText,
  confirmText,
  loadingText,
  isLoading = false,
  onConfirm,
  variant = 'default',
  className,
}: ConfirmModalProps) {
  const { t: tCommon } = useT('common');

  const handleClose = () => {
    if (!isLoading) {
      onOpenChange?.(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            {cancelText ?? tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              variant === 'destructive' && 'bg-red-600 hover:bg-red-700'
            )}
          >
            {isLoading ? (loadingText ?? tCommon('actions.loading')) : (confirmText ?? tCommon('actions.confirm'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DeleteModalProps {
  /** Whether the modal is open */
  open?: boolean;
  /** Callback when the modal open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Modal title */
  title: string;
  /** Confirmation message - can be string or JSX */
  description?: React.ReactNode;
  /** Optional preview of the item being deleted */
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
 * Delete modal - a specialized ConfirmModal for delete actions.
 * Uses destructive styling by default.
 */
export function DeleteModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  cancelText,
  deleteText,
  deletingText,
  isDeleting = false,
  onDelete,
  className,
}: DeleteModalProps) {
  const { t: tCommon } = useT('common');

  return (
    <ConfirmModal
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
      {children}
    </ConfirmModal>
  );
}

export interface ItemPreviewProps {
  /** Primary text (e.g., item name) */
  primary: string;
  /** Optional secondary text (e.g., item description) */
  secondary?: string;
  /** Additional className */
  className?: string;
}

/**
 * Preview component for showing item details in delete/confirm modals.
 */
export function ItemPreview({ primary, secondary, className }: ItemPreviewProps) {
  return (
    <div className={cn('bg-secondary/20 rounded-lg p-4', className)}>
      <div className="text-sm font-medium text-foreground">{primary}</div>
      {secondary && (
        <div className="text-xs text-muted-foreground mt-1">{secondary}</div>
      )}
    </div>
  );
}
