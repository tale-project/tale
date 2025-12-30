'use client';

import * as React from 'react';
import { memo, useCallback } from 'react';
import { DeleteModal } from '@/components/ui/modals';
import { toast } from '@/hooks/use-toast';

/**
 * Translation strings for the delete dialog.
 */
export interface DeleteEntityTranslations {
  /** Dialog title (e.g., "Delete Customer") */
  title: string;
  /** Description/confirmation message. Use {name} placeholder for entity name */
  description: string;
  /** Additional warning text (optional) */
  warningText?: string;
  /** Success toast message */
  successMessage: string;
  /** Error toast message */
  errorMessage: string;
}

export interface DeleteEntityDialogProps<TEntity> {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** The entity being deleted */
  entity: TEntity;
  /** Function to extract display name from entity */
  getEntityName: (entity: TEntity) => string;
  /** Async function to delete the entity */
  deleteMutation: (entity: TEntity) => Promise<void>;
  /** Translation strings */
  translations: DeleteEntityTranslations;
  /** Optional callback after successful deletion */
  onSuccess?: () => void;
}

/**
 * Generic delete entity dialog component.
 * Provides consistent delete confirmation UX across the application.
 *
 * @example
 * ```tsx
 * <DeleteEntityDialog
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   entity={customer}
 *   getEntityName={(c) => c.name || 'this customer'}
 *   deleteMutation={async (c) => deleteCustomer({ customerId: c._id })}
 *   translations={{
 *     title: t('deleteCustomer'),
 *     description: t('deleteConfirmation', { name: '{name}' }),
 *     warningText: t('deleteWarning'),
 *     successMessage: t('deleteSuccess'),
 *     errorMessage: t('deleteError'),
 *   }}
 * />
 * ```
 */
function DeleteEntityDialogInner<TEntity>({
  isOpen,
  onClose,
  entity,
  getEntityName,
  deleteMutation,
  translations,
  onSuccess,
}: DeleteEntityDialogProps<TEntity>) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const entityName = getEntityName(entity);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteMutation(entity);
      toast({
        title: translations.successMessage,
        variant: 'success',
      });
      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error deleting entity:', error);
      toast({
        title: translations.errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteMutation, entity, translations, onClose, onSuccess]);

  const description = React.useMemo(() => {
    const mainDescription = translations.description.replace('{name}', entityName);

    if (translations.warningText) {
      return (
        <>
          {mainDescription}
          <br />
          <br />
          {translations.warningText}
        </>
      );
    }

    return mainDescription;
  }, [translations.description, translations.warningText, entityName]);

  return (
    <DeleteModal
      open={isOpen}
      onOpenChange={() => onClose()}
      title={translations.title}
      description={description}
      isDeleting={isDeleting}
      onDelete={handleDelete}
    />
  );
}

export const DeleteEntityDialog = memo(DeleteEntityDialogInner) as typeof DeleteEntityDialogInner;

/**
 * Simple delete confirmation dialog that only needs a name string.
 * Useful when you don't have a full entity object.
 */
export interface SimpleDeleteDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Called when the dialog should close */
  onClose: () => void;
  /** Name of the item being deleted */
  itemName: string;
  /** Async function to perform the deletion */
  onDelete: () => Promise<void>;
  /** Translation strings */
  translations: DeleteEntityTranslations;
  /** Optional callback after successful deletion */
  onSuccess?: () => void;
}

/**
 * Simplified delete dialog that doesn't require an entity object.
 */
export const SimpleDeleteDialog = memo(function SimpleDeleteDialog({
  isOpen,
  onClose,
  itemName,
  onDelete,
  translations,
  onSuccess,
}: SimpleDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete();
      toast({
        title: translations.successMessage,
        variant: 'success',
      });
      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast({
        title: translations.errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, translations, onClose, onSuccess]);

  const description = React.useMemo(() => {
    const mainDescription = translations.description.replace('{name}', itemName);

    if (translations.warningText) {
      return (
        <>
          {mainDescription}
          <br />
          <br />
          {translations.warningText}
        </>
      );
    }

    return mainDescription;
  }, [translations.description, translations.warningText, itemName]);

  return (
    <DeleteModal
      open={isOpen}
      onOpenChange={() => onClose()}
      title={translations.title}
      description={description}
      isDeleting={isDeleting}
      onDelete={handleDelete}
    />
  );
});
