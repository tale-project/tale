'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { toast } from '@tale/ui/use-toast';
import * as React from 'react';
import { useCallback } from 'react';

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
  /** Success toast description (optional) */
  successDescription?: string;
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
  /**
   * The words under the failure toast, read from what the delete threw (for
   * example the refusal's reason, read through a helper that never shows an
   * error's payload). This toast is the failure's only report, so
   * `deleteMutation` keeps its own quiet. Without it the toast carries only
   * its title.
   */
  describeFailure?: (error: unknown) => string | undefined;
  /**
   * Stable element to restore focus to when the captured opener unmounts before
   * close (e.g. the row menu item that opened the dialog).
   */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
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
export function EntityDeleteDialog<TEntity>({
  isOpen,
  onClose,
  entity,
  getEntityName,
  deleteMutation,
  translations,
  onSuccess,
  describeFailure,
  restoreFocusRef,
}: EntityDeleteDialogProps<TEntity>) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const entityName = getEntityName(entity);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteMutation(entity);
      toast({
        title: translations.successMessage,
        description: translations.successDescription,
      });
      onClose();
      onSuccess?.();
    } catch (error) {
      console.error('Error deleting entity:', error);
      toast({
        title: translations.errorMessage,
        description: describeFailure?.(error),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [
    deleteMutation,
    entity,
    translations,
    onClose,
    onSuccess,
    describeFailure,
  ]);

  const description = React.useMemo(() => {
    const parts = translations.description.split('{name}');
    const styledDescription =
      parts.length > 1 ? (
        <>
          {parts.map((part, index) => (
            <React.Fragment key={index}>
              {part}
              {index < parts.length - 1 && (
                <span className="text-foreground font-semibold">
                  {entityName}
                </span>
              )}
            </React.Fragment>
          ))}
        </>
      ) : (
        translations.description
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
      restoreFocusRef={restoreFocusRef}
    />
  );
}
