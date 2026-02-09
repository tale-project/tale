'use client';

import * as React from 'react';
import { memo, useCallback } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { toast } from '@/app/hooks/use-toast';

/**
 * Translation strings for the delete dialog.
 */
interface EntityDeleteTranslations {
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

interface EntityDeleteDialogProps<TEntity> {
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
  translations: EntityDeleteTranslations;
  /** Optional callback after successful deletion */
  onSuccess?: () => void;
}

/**
 * Generic delete entity dialog component.
 * Provides consistent delete confirmation UX across the application.
 *
 * @example
 * ```tsx
 * <EntityDeleteDialog
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
function EntityDeleteDialogInner<TEntity>({
  isOpen,
  onClose,
  entity,
  getEntityName,
  deleteMutation,
  translations,
  onSuccess,
}: EntityDeleteDialogProps<TEntity>) {
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
    const parts = translations.description.split('{name}');
    const styledDescription =
      parts.length > 1 ? (
        <>
          {parts[0]}
          <span className="text-foreground font-semibold">{entityName}</span>
          {parts[1]}
        </>
      ) : (
        translations.description.replace('{name}', entityName)
      );

    if (translations.warningText) {
      return (
        <>
          {styledDescription}
          <br />
          <br />
          {translations.warningText}
        </>
      );
    }

    return styledDescription;
  }, [translations.description, translations.warningText, entityName]);

  return (
    <DeleteDialog
      open={isOpen}
      onOpenChange={() => onClose()}
      title={translations.title}
      description={description}
      isDeleting={isDeleting}
      onDelete={handleDelete}
    />
  );
}

export const EntityDeleteDialog = memo(
  EntityDeleteDialogInner,
) as typeof EntityDeleteDialogInner;
